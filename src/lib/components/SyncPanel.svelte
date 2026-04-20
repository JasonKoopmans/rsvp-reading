<script>
  import { createEventDispatcher } from "svelte";
  import QRCode from "qrcode";

  export let roomCode = null;
  export let peers = 0;
  export let status = "disconnected"; // 'disconnected' | 'connecting' | 'connected'
  export let configured = true;

  const dispatch = createEventDispatcher();
  let showPanel = false;
  let inputCode = "";
  let qrCodeDataUrl = "";
  let qrSourceUrl = "";
  let qrLoading = false;
  let qrRequestId = 0;

  const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function generateCode() {
    let code = "";
    for (let i = 0; i < 6; i++)
      code += CHARS[Math.floor(Math.random() * CHARS.length)];
    return code;
  }

  function handleCreate() {
    const code = generateCode();
    inputCode = code;
    dispatch("join", { code });
  }

  function handleJoin() {
    const code = inputCode.trim().toUpperCase();
    if (code.length < 3) return;
    dispatch("join", { code });
  }

  function handleDisconnect() {
    dispatch("disconnect");
    inputCode = "";
  }

  async function copyCode() {
    if (roomCode) await navigator.clipboard.writeText(roomCode).catch(() => {});
  }

  async function copyShareLink() {
    if (qrShareUrl)
      await navigator.clipboard.writeText(qrShareUrl).catch(() => {});
  }

  function getShareUrl(code) {
    if (typeof window === "undefined" || !code) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    return url.toString();
  }

  async function generateQrCode(url) {
    const requestId = ++qrRequestId;
    qrLoading = true;

    try {
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 180,
        color: {
          dark: "#ffffff",
          light: "#00000000",
        },
      });

      if (requestId !== qrRequestId) return;
      qrCodeDataUrl = dataUrl;
      qrSourceUrl = url;
    } catch {
      if (requestId !== qrRequestId) return;
      qrCodeDataUrl = "";
      qrSourceUrl = "";
    } finally {
      if (requestId === qrRequestId) qrLoading = false;
    }
  }

  $: dotColor =
    status === "connected"
      ? "#22c55e"
      : status === "connecting"
        ? "#f59e0b"
        : "#555";
  $: qrTargetCode =
    status === "connected" && roomCode
      ? roomCode
      : status === "connecting" && inputCode.trim().length >= 3
        ? inputCode.trim().toUpperCase()
        : "";
  $: qrShareUrl = qrTargetCode ? getShareUrl(qrTargetCode) : "";
  $: if (!qrShareUrl) {
    qrCodeDataUrl = "";
    qrSourceUrl = "";
    qrLoading = false;
  }
  $: if (qrShareUrl && qrShareUrl !== qrSourceUrl) {
    generateQrCode(qrShareUrl);
  }
</script>

<div class="sync-wrapper">
  <button
    class="sync-btn"
    class:active={status === "connected"}
    on:click={() => (showPanel = !showPanel)}
    title="Sync devices"
  >
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path
        d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
      />
    </svg>
    <span class="dot" style="background:{dotColor}"></span>
  </button>

  {#if showPanel}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" on:click={() => (showPanel = false)}></div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Sync</span>
        <button
          class="close-x"
          on:click={() => (showPanel = false)}
          aria-label="Close sync panel"
          title="Close sync panel"
        >
          <svg viewBox="0 0 24 24" fill="currentColor"
            ><path
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            /></svg
          >
        </button>
      </div>

      {#if !configured}
        <p class="hint">
          Sync is unavailable because no WebSocket URL could be resolved.
        </p>
      {:else if status === "connected" && roomCode}
        <div class="room-code">{roomCode}</div>
        {#if qrShareUrl}
          <div class="qr-wrap">
            {#if qrCodeDataUrl}
              <img
                class="qr-code"
                src={qrCodeDataUrl}
                alt={`QR code to join room ${roomCode}`}
              />
            {:else if qrLoading}
              <div class="qr-placeholder">Generating QR…</div>
            {/if}
            <p class="qr-caption">Scan to open this room on another device</p>
          </div>
        {/if}
        <p class="peers-label">
          {peers} other device{peers !== 1 ? "s" : ""} connected
        </p>
        <div class="row">
          <button class="btn secondary" on:click={copyCode}>Copy code</button>
          <button class="btn secondary" on:click={copyShareLink}
            >Copy link</button
          >
          <button class="btn danger" on:click={handleDisconnect}>Leave</button>
        </div>
      {:else if status === "connecting"}
        <div class="connecting">
          <div class="spinner"></div>
          <span>Connecting…</span>
        </div>
        {#if qrTargetCode}
          <div class="room-code room-code-compact">{qrTargetCode}</div>
          {#if qrShareUrl}
            <div class="qr-wrap">
              {#if qrCodeDataUrl}
                <img
                  class="qr-code"
                  src={qrCodeDataUrl}
                  alt={`QR code to join room ${qrTargetCode}`}
                />
              {:else if qrLoading}
                <div class="qr-placeholder">Generating QR…</div>
              {/if}
              <p class="qr-caption">
                Scan to join while this device is connecting
              </p>
            </div>
          {/if}
          <button class="btn secondary full" on:click={copyShareLink}
            >Copy link</button
          >
        {/if}
      {:else}
        <button class="btn primary full" on:click={handleCreate}
          >Create room</button
        >
        <div class="divider"><span>or join existing</span></div>
        <div class="row">
          <input
            class="code-input"
            type="text"
            bind:value={inputCode}
            placeholder="Room code"
            maxlength="12"
            on:keydown={(e) => e.key === "Enter" && handleJoin()}
            on:input={() => (inputCode = inputCode.toUpperCase())}
          />
          <button
            class="btn primary"
            on:click={handleJoin}
            disabled={inputCode.trim().length < 3}
          >
            Join
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sync-wrapper {
    position: relative;
  }

  .sync-btn {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    padding: 0.5rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .sync-btn:hover {
    border-color: #555;
    color: #fff;
  }
  .sync-btn.active {
    border-color: #22c55e;
    color: #22c55e;
  }

  .sync-btn svg {
    width: 20px;
    height: 20px;
  }

  .dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid #000;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 100;
    background: #0f0f0f;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 1.25rem;
    width: 260px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .panel-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .close-x {
    background: none;
    border: none;
    color: #444;
    cursor: pointer;
    padding: 2px;
    display: flex;
    border-radius: 4px;
    transition: color 0.15s;
  }
  .close-x:hover {
    color: #fff;
  }
  .close-x svg {
    width: 18px;
    height: 18px;
  }

  .room-code {
    font-family: "SF Mono", "Monaco", monospace;
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: #fff;
    text-align: center;
    padding: 0.75rem 0;
  }

  .room-code.room-code-compact {
    font-size: 1.2rem;
    letter-spacing: 0.12em;
    padding: 0.25rem 0 0.75rem;
  }

  .qr-wrap {
    margin: 0.25rem 0 0.75rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .qr-code,
  .qr-placeholder {
    width: 170px;
    height: 170px;
    border-radius: 10px;
    border: 1px solid #2b2b2b;
    background: #0b0b0b;
  }

  .qr-code {
    object-fit: contain;
    padding: 8px;
    box-sizing: border-box;
  }

  .qr-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 0.78rem;
  }

  .qr-caption {
    margin: 0;
    text-align: center;
    color: #666;
    font-size: 0.76rem;
    line-height: 1.3;
  }

  .peers-label {
    text-align: center;
    color: #555;
    font-size: 0.8rem;
    margin: 0 0 1rem;
  }

  .hint {
    color: #555;
    font-size: 0.8rem;
    line-height: 1.5;
    margin: 0;
  }
  .connecting {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: #666;
    font-size: 0.9rem;
    padding: 0.5rem 0;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #333;
    border-top-color: #f59e0b;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.875rem 0;
    color: #333;
    font-size: 0.75rem;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: #222;
  }
  .divider span {
    color: #444;
    white-space: nowrap;
  }

  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn {
    padding: 0.55rem 1rem;
    border-radius: 7px;
    border: none;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .btn.full {
    width: 100%;
  }

  .btn.primary {
    background: #ff4444;
    color: #fff;
  }
  .btn.primary:hover:not(:disabled) {
    background: #ff6666;
  }

  .btn.secondary {
    background: #1e1e1e;
    color: #aaa;
    border: 1px solid #333;
  }
  .btn.secondary:hover {
    background: #2a2a2a;
    color: #fff;
  }

  .btn.danger {
    background: #1e1e1e;
    color: #f87171;
    border: 1px solid #3a1a1a;
  }
  .btn.danger:hover {
    background: #2a1a1a;
  }

  .code-input {
    flex: 1;
    min-width: 0;
    background: #111;
    border: 1px solid #333;
    border-radius: 7px;
    color: #fff;
    font-size: 0.9rem;
    font-family: "SF Mono", "Monaco", monospace;
    letter-spacing: 0.08em;
    padding: 0.55rem 0.75rem;
    text-transform: uppercase;
    outline: none;
  }
  .code-input:focus {
    border-color: #ff4444;
  }
  .code-input::placeholder {
    color: #333;
    text-transform: none;
    letter-spacing: normal;
  }
</style>
