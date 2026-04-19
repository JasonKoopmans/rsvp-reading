import { createServer } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const MAX_MESSAGE_BYTES = Number.parseInt(
  process.env.MAX_MESSAGE_BYTES ?? "32768",
  10,
);
const MAX_TEXT_LENGTH = Number.parseInt(
  process.env.MAX_TEXT_LENGTH ?? "200000",
  10,
);
const MAX_WORD_INDEX = Number.parseInt(
  process.env.MAX_WORD_INDEX ?? "10000000",
  10,
);
const RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.RATE_LIMIT_WINDOW_MS ?? "1000",
  10,
);
const RATE_LIMIT_MAX_MESSAGES = Number.parseInt(
  process.env.RATE_LIMIT_MAX_MESSAGES ?? "60",
  10,
);
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];
const ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const DIST_DIR = path.join(process.cwd(), "dist");
const IMMUTABLE_FILE_PATTERN = /\.[a-f0-9]{8,}\./i;
const MIME_BY_EXTENSION = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// roomCode -> { clients: Set<WebSocket>, state: Object|null }
const rooms = new Map();

const server = createServer((req, res) => {
  const requestUrl = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  if (!existsSync(DIST_DIR)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Frontend build not found. Run npm run build.");
    return;
  }

  const pathname = sanitizePathname(requestUrl.pathname);
  const candidate = path.join(DIST_DIR, pathname);

  if (isSafeFile(candidate) && statSync(candidate).isFile()) {
    serveFile(req, res, candidate);
    return;
  }

  const indexPath = path.join(DIST_DIR, "index.html");
  if (isSafeFile(indexPath) && statSync(indexPath).isFile()) {
    serveFile(req, res, indexPath, false);
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_MESSAGE_BYTES,
});

// Keep-alive pings every 30s to prevent proxy timeouts
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on("close", () => clearInterval(pingInterval));

wss.on("connection", (ws, req) => {
  const origin = String(req.headers.origin ?? "");
  if (!isAllowedOrigin(origin)) {
    ws.close(1008, "Origin not allowed");
    return;
  }

  ws.isAlive = true;
  ws.roomCode = null;
  ws.rateWindowStart = Date.now();
  ws.rateCount = 0;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    if (isRateLimited(ws)) {
      ws.close(1008, "Rate limit exceeded");
      return;
    }

    if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES) {
      ws.close(1009, "Message too large");
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    if (msg.type === "join") {
      const code = normalizeRoomCode(msg.roomCode);
      if (!code) return;

      leaveRoomIfNeeded(ws);

      if (!rooms.has(code))
        rooms.set(code, { clients: new Set(), state: null });
      const room = rooms.get(code);

      ws.roomCode = code;
      room.clients.add(ws);

      ws.send(
        JSON.stringify({
          type: "room_joined",
          roomCode: code,
          peers: room.clients.size - 1,
          state: room.state,
        }),
      );

      broadcast(room, ws, { type: "peers", count: room.clients.size });
      return;
    }

    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (!isValidClientMessage(msg)) return;

    updateState(room, msg);
    broadcast(room, ws, msg);
  });

  ws.on("close", () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(ws.roomCode);
    } else {
      broadcast(room, null, { type: "peers", count: room.clients.size });
    }
  });

  ws.on("error", () => {});
});

function broadcast(room, sender, msg) {
  const data = JSON.stringify(msg);
  for (const client of room.clients) {
    if (client !== sender && client.readyState === 1) client.send(data);
  }
}

function updateState(room, msg) {
  if (!room.state) room.state = {};
  switch (msg.type) {
    case "text_update":
      room.state.text = msg.text;
      break;
    case "settings":
      room.state.settings = msg.settings;
      break;
    case "playback":
      if (msg.wordIndex != null) room.state.wordIndex = msg.wordIndex;
      room.state.isPlaying = msg.action === "play";
      room.state.isPaused = msg.action === "pause";
      if (msg.action === "stop" || msg.action === "restart") {
        room.state.isPlaying = msg.action === "restart" ? false : false;
        room.state.isPaused = false;
        room.state.wordIndex = 0;
      }
      break;
    case "seek":
    case "heartbeat":
      room.state.wordIndex = msg.wordIndex;
      break;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowlist =
    ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;
  return allowlist.includes(origin);
}

function isRateLimited(ws) {
  const now = Date.now();
  if (now - ws.rateWindowStart >= RATE_LIMIT_WINDOW_MS) {
    ws.rateWindowStart = now;
    ws.rateCount = 0;
  }
  ws.rateCount += 1;
  return ws.rateCount > RATE_LIMIT_MAX_MESSAGES;
}

function normalizeRoomCode(value) {
  const code = String(value ?? "")
    .toUpperCase()
    .slice(0, 12);
  if (!/^[A-Z0-9]{3,12}$/.test(code)) return null;
  return code;
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_WORD_INDEX;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isValidSettings(settings) {
  if (!isPlainObject(settings)) return false;
  const validators = {
    wordsPerMinute: (v) => Number.isFinite(v) && v >= 50 && v <= 2000,
    fadeEnabled: (v) => typeof v === "boolean",
    fadeDuration: (v) => Number.isFinite(v) && v >= 0 && v <= 1000,
    pauseOnPunctuation: (v) => typeof v === "boolean",
    punctuationPauseMultiplier: (v) => Number.isFinite(v) && v >= 1 && v <= 8,
    wordLengthWPMMultiplier: (v) => Number.isFinite(v) && v >= 0 && v <= 20,
    pauseAfterWords: (v) => Number.isFinite(v) && v >= 0 && v <= 200,
    pauseDuration: (v) => Number.isFinite(v) && v >= 0 && v <= 5000,
    frameWordCount: (v) => Number.isFinite(v) && v >= 1 && v <= 10,
  };

  for (const [key, value] of Object.entries(settings)) {
    if (!(key in validators)) return false;
    if (!validators[key](value)) return false;
  }

  return true;
}

function isValidClientMessage(msg) {
  switch (msg.type) {
    case "text_update":
      return typeof msg.text === "string" && msg.text.length <= MAX_TEXT_LENGTH;
    case "settings":
      return isValidSettings(msg.settings);
    case "playback":
      return (
        ["play", "pause", "stop", "restart"].includes(msg.action) &&
        (msg.wordIndex == null || isNonNegativeInt(msg.wordIndex))
      );
    case "seek":
    case "heartbeat":
      return isNonNegativeInt(msg.wordIndex);
    default:
      return false;
  }
}

function leaveRoomIfNeeded(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  room.clients.delete(ws);
  if (room.clients.size === 0) {
    rooms.delete(ws.roomCode);
  } else {
    broadcast(room, null, { type: "peers", count: room.clients.size });
  }
}

function sanitizePathname(pathname) {
  if (!pathname || pathname === "/") return "index.html";
  const normalized = path.posix.normalize(pathname).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..")) return "index.html";
  return normalized;
}

function isSafeFile(filePath) {
  try {
    return filePath.startsWith(DIST_DIR) && existsSync(filePath);
  } catch {
    return false;
  }
}

function serveFile(req, res, filePath, useImmutableCache = true) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType =
    MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
  const cacheControl =
    useImmutableCache && IMMUTABLE_FILE_PATTERN.test(path.basename(filePath))
      ? "public, max-age=31536000, immutable"
      : "no-cache";

  const contentLength = statSync(filePath).size;
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Length": contentLength,
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

server.listen(PORT, () => console.log(`rsvp-sync listening on :${PORT}`));
