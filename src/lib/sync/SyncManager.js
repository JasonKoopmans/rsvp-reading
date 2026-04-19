const WS_URL = import.meta.env.VITE_WS_URL?.trim() ?? "";

function resolveWsUrl() {
  if (WS_URL) return WS_URL;
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export class SyncManager {
  #ws = null;
  #roomCode = null;
  #heartbeatInterval = null;
  #reconnectTimeout = null;
  #pendingRoom = null;

  // Callbacks — set by the consumer
  onTextUpdate = null;
  onSettings = null;
  onPlayback = null;
  onSeek = null;
  onHeartbeat = null;
  onPeers = null;
  onConnected = null;
  onDisconnected = null;

  get roomCode() {
    return this.#roomCode;
  }
  get isConnected() {
    return this.#ws?.readyState === WebSocket.OPEN && this.#roomCode != null;
  }
  get isConfigured() {
    return !!resolveWsUrl();
  }

  joinRoom(code) {
    if (!this.isConfigured) {
      console.warn("WebSocket URL could not be resolved — sync disabled");
      return;
    }
    this.#pendingRoom = code.toUpperCase();
    this.#connect();
  }

  #connect() {
    clearTimeout(this.#reconnectTimeout);
    if (this.#ws) {
      this.#ws.onclose = null;
      this.#ws.onerror = null;
      this.#ws.close();
    }

    this.#ws = new WebSocket(resolveWsUrl());

    this.#ws.onopen = () => {
      this.#ws.send(
        JSON.stringify({ type: "join", roomCode: this.#pendingRoom }),
      );
    };

    this.#ws.onmessage = ({ data }) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      this.#handle(msg);
    };

    this.#ws.onclose = () => {
      this.#roomCode = null;
      this.onDisconnected?.();
      if (this.#pendingRoom) {
        this.#reconnectTimeout = setTimeout(() => this.#connect(), 3000);
      }
    };

    this.#ws.onerror = () => {};
  }

  #handle(msg) {
    switch (msg.type) {
      case "room_joined":
        this.#roomCode = msg.roomCode;
        this.onConnected?.(msg.roomCode, msg.peers, msg.state);
        break;
      case "peers":
        this.onPeers?.(msg.count);
        break;
      case "text_update":
        this.onTextUpdate?.(msg.text);
        break;
      case "settings":
        this.onSettings?.(msg.settings);
        break;
      case "playback":
        this.onPlayback?.(msg.action, msg.wordIndex);
        break;
      case "seek":
        this.onSeek?.(msg.wordIndex);
        break;
      case "heartbeat":
        this.onHeartbeat?.(msg.wordIndex);
        break;
    }
  }

  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN && this.#roomCode) {
      this.#ws.send(JSON.stringify(msg));
    }
  }

  sendTextUpdate(text) {
    this.#send({ type: "text_update", text });
  }
  sendSettings(settings) {
    this.#send({ type: "settings", settings });
  }
  sendPlayback(action, wordIndex) {
    this.#send({ type: "playback", action, wordIndex });
  }
  sendSeek(wordIndex) {
    this.#send({ type: "seek", wordIndex });
  }

  startHeartbeat(getWordIndex) {
    this.stopHeartbeat();
    this.#heartbeatInterval = setInterval(() => {
      this.#send({ type: "heartbeat", wordIndex: getWordIndex() });
    }, 300);
  }

  stopHeartbeat() {
    clearInterval(this.#heartbeatInterval);
    this.#heartbeatInterval = null;
  }

  disconnect() {
    this.#pendingRoom = null;
    clearTimeout(this.#reconnectTimeout);
    this.stopHeartbeat();
    if (this.#ws) {
      this.#ws.onclose = null;
      this.#ws.onerror = null;
      this.#ws.close();
      this.#ws = null;
    }
    this.#roomCode = null;
  }
}
