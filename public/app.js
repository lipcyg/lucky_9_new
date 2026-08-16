const storage = {
  code: "lucky9.sessionCode",
  playerId: "lucky9.playerId",
  name: "lucky9.playerName",
  serverUrl: "lucky9.serverUrl"
};

const appConfig = window.LUCKY9_CONFIG || {};
const configuredServerUrl = normalizeServerUrl(appConfig.serverUrl);
const hasConfiguredServerUrl = Boolean(configuredServerUrl);
const allowManualServerUrl = appConfig.allowManualServerUrl === true;

const app = document.querySelector("#app");
const statusBar = document.querySelector("#statusBar");
const sessionLine = document.querySelector("#sessionLine");
const installButton = document.querySelector("#installButton");

let state = null;
let eventSource = null;
let pollTimer = null;
let selectedCardIds = new Set();
let deferredInstallPrompt = null;
let busy = false;

const identity = {
  code: localStorage.getItem(storage.code),
  playerId: localStorage.getItem(storage.playerId),
  name: localStorage.getItem(storage.name) || "",
  serverUrl: configuredServerUrl || normalizeServerUrl(localStorage.getItem(storage.serverUrl) || "")
};

if (hasConfiguredServerUrl) {
  localStorage.removeItem(storage.serverUrl);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  installButton.classList.add("hidden");
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  if (form.id === "createForm") {
    await runAction(async () => {
      const playerName = formData.get("playerName");
      setServerUrl(getSubmittedServerUrl(formData));
      const payload = await postJson("/api/sessions", { playerName });
      setIdentity(payload.code, payload.playerId, playerName);
      state = payload.state;
      selectedCardIds.clear();
      connectEvents();
      setStatus("Session created.", "success");
      render();
    });
  }

  if (form.id === "joinForm") {
    await runAction(async () => {
      const playerName = formData.get("playerName");
      setServerUrl(getSubmittedServerUrl(formData));
      const code = String(formData.get("code") || "").trim().toUpperCase();
      const payload = await postJson(`/api/sessions/${encodeURIComponent(code)}/join`, { playerName });
      setIdentity(payload.code, payload.playerId, playerName);
      state = payload.state;
      selectedCardIds.clear();
      connectEvents();
      setStatus("Joined session.", "success");
      render();
    });
  }
});

app.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-card-id]");

  if (card && card.dataset.selectable === "true") {
    const id = card.dataset.cardId;

    if (selectedCardIds.has(id)) {
      selectedCardIds.delete(id);
    } else {
      selectedCardIds.add(id);
    }

    render();
    return;
  }

  const button = event.target.closest("[data-action]");

  if (!button || button.disabled) {
    return;
  }

  const action = button.dataset.action;

  if (action === "leave") {
    leaveSession();
    return;
  }

  if (action === "copy-code") {
    await copySessionCode();
    return;
  }

  if (action === "ready") {
    const viewer = getViewer();
    await runAction(async () => {
      const payload = await postJson(`/api/sessions/${state.code}/ready`, {
        playerId: identity.playerId,
        ready: !viewer.ready
      });
      state = payload.state;
      render();
    });
    return;
  }

  if (action === "discard") {
    await runAction(async () => {
      const payload = await postJson(`/api/sessions/${state.code}/discard`, {
        playerId: identity.playerId,
        cardIds: [...selectedCardIds]
      });
      state = payload.state;
      selectedCardIds.clear();
      render();
    });
    return;
  }

  if (action === "draw-stack" || action === "draw-open") {
    await runAction(async () => {
      const payload = await postJson(`/api/sessions/${state.code}/draw`, {
        playerId: identity.playerId,
        source: action === "draw-stack" ? "drawStack" : "openPile"
      });
      state = payload.state;
      render();
    });
    return;
  }

  if (action === "show") {
    await runAction(async () => {
      const payload = await postJson(`/api/sessions/${state.code}/show`, {
        playerId: identity.playerId
      });
      state = payload.state;
      render();
    });
    return;
  }

  if (action === "end-turn") {
    await runAction(async () => {
      const payload = await postJson(`/api/sessions/${state.code}/end-turn`, {
        playerId: identity.playerId
      });
      state = payload.state;
      render();
    });
  }
});

restoreSession();
render();

window.setInterval(() => {
  if (state?.round?.status === "active") {
    render();
  }
}, 1000);

async function restoreSession() {
  if (!identity.code || !identity.playerId) {
    return;
  }

  try {
    const payload = await getJson(`/api/sessions/${identity.code}/state?playerId=${identity.playerId}`);
    state = payload.state;
    connectEvents();
    setStatus("Session restored.", "success");
    render();
  } catch (error) {
    clearIdentity();
    setStatus(error.message, "error");
    render();
  }
}

function connectEvents() {
  if (eventSource) {
    eventSource.close();
  }

  stopPolling();

  if (!identity.code || !identity.playerId) {
    return;
  }

  eventSource = new EventSource(apiPath(`/api/sessions/${identity.code}/events?playerId=${identity.playerId}`));

  eventSource.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    trimSelectedCards();
    render();
  });

  eventSource.addEventListener("error", () => {
    if (state) {
      setStatus("Live connection interrupted. Using polling...", "warn");
    }

    eventSource?.close();
    eventSource = null;
    startPolling();
  });
}

function startPolling() {
  if (pollTimer || !identity.code || !identity.playerId) {
    return;
  }

  const poll = async () => {
    try {
      const payload = await getJson(`/api/sessions/${identity.code}/state?playerId=${identity.playerId}`);
      state = payload.state;
      trimSelectedCards();
      render();
    } catch (error) {
      setStatus(error.message, "error");
    }
  };

  pollTimer = window.setInterval(poll, 2000);
  poll();
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function render() {
  if (!state) {
    sessionLine.textContent = "No session";
    app.innerHTML = renderHome();
    return;
  }

  const viewer = getViewer();
  const statusLabel = state.status.replace(/_/g, " ");
  sessionLine.textContent = `Session ${state.code} - ${statusLabel}`;

  if (!viewer) {
    app.innerHTML = renderUnknownViewer();
    return;
  }

  app.innerHTML = `
    <section class="session-layout">
      ${renderScores()}
      ${state.status === "lobby" ? renderLobby(viewer) : renderGame(viewer)}
    </section>
  `;
}

function renderHome() {
  const savedName = escapeHtml(identity.name);
  const savedServerUrl = escapeHtml(identity.serverUrl);
  const serverUrlField = renderServerUrlField(savedServerUrl);

  return `
    <section class="entry-grid">
      <form id="createForm" class="entry-panel">
        <h2>Create Game</h2>
        ${serverUrlField}
        <label>
          <span>Name</span>
          <input name="playerName" maxlength="24" autocomplete="name" value="${savedName}" required />
        </label>
        <button class="primary-button" type="submit" ${busy ? "disabled" : ""}>Create</button>
      </form>

      <form id="joinForm" class="entry-panel">
        <h2>Join Game</h2>
        ${serverUrlField}
        <label>
          <span>Code</span>
          <input name="code" maxlength="8" inputmode="latin" autocapitalize="characters" required />
        </label>
        <label>
          <span>Name</span>
          <input name="playerName" maxlength="24" autocomplete="name" value="${savedName}" required />
        </label>
        <button class="primary-button" type="submit" ${busy ? "disabled" : ""}>Join</button>
      </form>
    </section>
  `;
}

function renderServerUrlField(savedServerUrl) {
  if (hasConfiguredServerUrl || !allowManualServerUrl) {
    return "";
  }

  return `
    <label>
      <span>Server URL</span>
      <input name="serverUrl" inputmode="url" placeholder="Leave blank for this server" value="${savedServerUrl}" />
    </label>
  `;
}

function renderUnknownViewer() {
  return `
    <section class="empty-state">
      <h2>Session Unavailable</h2>
      <button class="secondary-button" type="button" data-action="leave">Reset</button>
    </section>
  `;
}

function renderScores() {
  return `
    <aside class="score-band" aria-label="Scores">
      ${state.players
        .filter((player) => !player.removed)
        .map(
          (player) => `
            <div class="score-tile ${player.eliminated ? "is-eliminated" : ""} ${player.isViewer ? "is-viewer" : ""}">
              <div class="score-name">
                <span>${escapeHtml(player.name)}</span>
                ${player.host ? '<span class="host-pill">Host</span>' : ""}
              </div>
              <strong>${player.score}</strong>
              <div class="score-meta">
                ${player.eliminated ? "Out" : player.connected ? "Online" : "Offline"}
              </div>
            </div>
          `
        )
        .join("")}
    </aside>
  `;
}

function renderLobby(viewer) {
  const players = state.players.filter((player) => !player.removed);
  const readyCount = players.filter((player) => player.ready).length;
  const canReady = !busy && players.length >= 2;

  return `
    <section class="lobby-grid">
      <div class="session-code-panel">
        <div>
          <span class="eyebrow">Code</span>
          <strong>${state.code}</strong>
        </div>
        <button class="secondary-button" type="button" data-action="copy-code">Copy</button>
      </div>

      <div class="lobby-list">
        ${players
          .map(
            (player) => `
              <div class="lobby-row">
                <span>${escapeHtml(player.name)}</span>
                <span>${player.ready ? "Ready" : "Waiting"}</span>
              </div>
            `
          )
          .join("")}
      </div>

      <div class="action-strip">
        <button class="primary-button" type="button" data-action="ready" ${canReady ? "" : "disabled"}>
          ${viewer.ready ? "Unready" : "Ready"}
        </button>
        <button class="ghost-button" type="button" data-action="leave">Leave</button>
        <span>${readyCount}/${players.length}</span>
      </div>
    </section>
  `;
}

function renderGame(viewer) {
  const round = state.round;
  const winner = state.players.find((player) => player.id === state.winnerId);

  if (!round) {
    return `
      <section class="empty-state">
        <h2>${winner ? `${escapeHtml(winner.name)} Wins` : "Game"}</h2>
        <button class="secondary-button" type="button" data-action="leave">Exit</button>
      </section>
    `;
  }

  const viewerHand = round.hands[identity.playerId];
  const isTurn = round.currentPlayerId === identity.playerId && round.status === "active";

  return `
    <section class="game-layout">
      <div class="turn-banner ${isTurn ? "is-turn" : ""}">
        <div>
          <span class="eyebrow">Round ${round.number}</span>
          <strong>${renderTurnText(round, winner)}</strong>
        </div>
        ${renderTurnTimer(round)}
        <button class="ghost-button" type="button" data-action="leave">Exit</button>
      </div>

      <div class="table-zone">
        ${renderPile("Draw Stack", round.drawStackCount, null, "draw-stack", isTurn && round.phase === "draw")}
        ${renderPile("Open Pile", round.openPileCount, round.openPileTop, "draw-open", isTurn && round.phase === "draw" && Boolean(round.openPileTop))}
      </div>

      <section class="opponent-zone">
        ${state.players
          .filter((player) => !player.removed && player.id !== identity.playerId && round.hands[player.id])
          .map((player) => renderPlayerHand(player, round.hands[player.id], false))
          .join("")}
      </section>

      <section class="hand-zone">
        <div class="hand-heading">
          <h2>Your Hand</h2>
          <span>${viewerHand?.hidden ? "" : `Total ${viewerHand.total}`}</span>
        </div>
        <div class="card-row player-cards">
          ${(viewerHand?.cards || []).map((card) => renderCard(card, { selectable: isTurn && round.phase === "discard" })).join("")}
        </div>
      </section>

      ${renderActions(round, viewerHand, isTurn)}
      ${renderRoundSummary(round)}
      ${renderLog()}
    </section>
  `;
}

function renderTurnText(round, winner) {
  if (winner) {
    return `${escapeHtml(winner.name)} wins`;
  }

  if (state.status === "round_over") {
    return "Round scored";
  }

  if (round.status === "complete") {
    return "Round scored";
  }

  return `${escapeHtml(round.currentPlayerName)} to ${phaseLabel(round.phase)}`;
}

function phaseLabel(phase) {
  if (phase === "discard") {
    return "discard or show";
  }

  if (phase === "draw") {
    return "draw";
  }

  if (phase === "show_or_end") {
    return "show";
  }

  return "play";
}

function renderTurnTimer(round) {
  if (!round.turnEndsAt || round.status !== "active") {
    return "";
  }

  const remainingSeconds = Math.max(0, Math.ceil((round.turnEndsAt - Date.now()) / 1000));

  return `
    <div class="turn-timer" aria-label="Turn timer">
      <span>${remainingSeconds}</span>
      <small>s</small>
    </div>
  `;
}

function renderPile(label, count, topCard, action, enabled) {
  return `
    <div class="pile">
      <span class="eyebrow">${label}</span>
      <div class="pile-card">
        ${topCard ? renderCard(topCard, { compact: true }) : '<div class="card card-back"><span>9</span></div>'}
      </div>
      <div class="pile-footer">
        <span>${count} cards</span>
        <button class="secondary-button" type="button" data-action="${action}" ${enabled && !busy ? "" : "disabled"}>Draw</button>
      </div>
    </div>
  `;
}

function renderPlayerHand(player, hand) {
  return `
    <div class="opponent-hand ${player.eliminated ? "is-eliminated" : ""}">
      <div class="opponent-topline">
        <strong>${escapeHtml(player.name)}</strong>
        <span>${hand.hidden ? `${hand.count} cards` : `Total ${hand.total}`}</span>
      </div>
      <div class="mini-card-row">
        ${hand.hidden
          ? Array.from({ length: hand.count }, () => '<div class="mini-card card-back"><span>9</span></div>').join("")
          : hand.cards.map((card) => renderCard(card, { compact: true })).join("")}
      </div>
    </div>
  `;
}

function renderCard(card, options = {}) {
  const selected = selectedCardIds.has(card.id);
  const selectable = Boolean(options.selectable);
  const compact = Boolean(options.compact);
  const red = card.suit === "H" || card.suit === "D";
  const tag = selectable ? "button" : "div";

  return `
    <${tag}
      class="card ${compact ? "is-compact" : ""} ${red ? "is-red" : ""} ${selected ? "is-selected" : ""}"
      ${selectable ? 'type="button"' : ""}
      data-card-id="${escapeAttribute(card.id)}"
      data-selectable="${selectable ? "true" : "false"}"
      aria-pressed="${selectable ? String(selected) : "false"}"
    >
      <span class="card-rank">${escapeHtml(card.rank)}</span>
      <span class="card-suit">${escapeHtml(card.suit)}</span>
      <span class="card-value">${card.value}</span>
    </${tag}>
  `;
}

function renderActions(round, viewerHand, isTurn) {
  const selectedCount = selectedCardIds.size;
  const canDiscard = isTurn && round.phase === "discard" && selectedCount > 0;
  const canShow =
    isTurn && (round.phase === "discard" || round.phase === "show_or_end") && viewerHand && viewerHand.total <= 9;

  if (isTurn && round.phase === "draw") {
    return `
      <section class="action-strip game-actions">
        <button class="primary-button" type="button" data-action="draw-stack" ${busy ? "disabled" : ""}>
          Draw Stack
        </button>
        <button class="secondary-button" type="button" data-action="draw-open" ${round.openPileTop && !busy ? "" : "disabled"}>
          Draw Open
        </button>
      </section>
    `;
  }

  return `
    <section class="action-strip game-actions">
      <button class="primary-button" type="button" data-action="discard" ${canDiscard && !busy ? "" : "disabled"}>
        Discard ${selectedCount || ""}
      </button>
      <button class="danger-button" type="button" data-action="show" ${canShow && !busy ? "" : "disabled"}>Show</button>
    </section>
  `;
}

function renderRoundSummary(round) {
  if (!round.scoring) {
    return "";
  }

  const rows = Object.entries(round.scoring.deltas)
    .map(([playerId, delta]) => {
      const player = state.players.find((candidate) => candidate.id === playerId);
      const total = round.totals[playerId];
      const signed = delta > 0 ? `+${delta}` : String(delta);
      return `
        <div class="summary-row">
          <span>${escapeHtml(player?.name || "Player")}</span>
          <span>Total ${total}</span>
          <strong>${signed}</strong>
        </div>
      `;
    })
    .join("");

  return `
    <section class="round-summary">
      <div class="summary-title">
        <h2>${round.scoring.failed ? "Failed Show" : "Successful Show"}</h2>
        <span>${escapeHtml(playerName(round.scoring.showingPlayerId))}</span>
      </div>
      ${rows}
    </section>
  `;
}

function renderLog() {
  return `
    <section class="event-log">
      ${state.logs
        .slice()
        .reverse()
        .slice(0, 8)
        .map((entry) => `<div>${escapeHtml(entry.message)}</div>`)
        .join("")}
    </section>
  `;
}

async function postJson(path, body) {
  return requestJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function getJson(path) {
  return requestJson(path, { method: "GET" });
}

async function requestJson(path, options) {
  const target = apiPath(path);
  let response;

  try {
    response = await fetch(target, options);
  } catch {
    const serverUrl = normalizeServerUrl(identity.serverUrl);
    const message = serverUrl
      ? `Cannot reach Lucky 9 server at ${serverUrl}. Check that the server is running and this device can open that address.`
      : "Cannot reach the Lucky 9 server. Start the server or build the app with a valid ServerUrl.";

    throw new Error(message);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || "Request failed.");
  }

  return payload;
}

function apiPath(path) {
  const base = normalizeServerUrl(identity.serverUrl);
  return base ? `${base}${path}` : path;
}

async function runAction(action) {
  if (busy) {
    return;
  }

  busy = true;
  render();

  try {
    await action();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    busy = false;
    render();
  }
}

function setIdentity(code, playerId, playerName) {
  identity.code = code;
  identity.playerId = playerId;
  identity.name = String(playerName || "").trim();
  localStorage.setItem(storage.code, identity.code);
  localStorage.setItem(storage.playerId, identity.playerId);
  localStorage.setItem(storage.name, identity.name);
}

function setServerUrl(serverUrl) {
  if (hasConfiguredServerUrl || !allowManualServerUrl) {
    identity.serverUrl = configuredServerUrl;
    localStorage.removeItem(storage.serverUrl);
    return;
  }

  identity.serverUrl = normalizeServerUrl(serverUrl);

  if (identity.serverUrl) {
    localStorage.setItem(storage.serverUrl, identity.serverUrl);
  } else {
    localStorage.removeItem(storage.serverUrl);
  }
}

function getSubmittedServerUrl(formData) {
  return allowManualServerUrl && !hasConfiguredServerUrl ? formData.get("serverUrl") : configuredServerUrl;
}

function normalizeServerUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function clearIdentity() {
  identity.code = null;
  identity.playerId = null;
  localStorage.removeItem(storage.code);
  localStorage.removeItem(storage.playerId);
}

function leaveSession() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  stopPolling();

  clearIdentity();
  state = null;
  selectedCardIds.clear();
  setStatus("Exited session.", "success");
  render();
}

async function copySessionCode() {
  try {
    await navigator.clipboard.writeText(state.code);
    setStatus("Code copied.", "success");
  } catch {
    setStatus(state.code, "success");
  }
}

function trimSelectedCards() {
  const hand = state?.round?.hands?.[identity.playerId];
  const ids = new Set((hand?.cards || []).map((card) => card.id));
  selectedCardIds = new Set([...selectedCardIds].filter((id) => ids.has(id)));
}

function getViewer() {
  return state?.players.find((player) => player.id === identity.playerId && !player.removed);
}

function playerName(playerId) {
  return state.players.find((player) => player.id === playerId)?.name || "Player";
}

function setStatus(message, type = "info") {
  statusBar.textContent = message;
  statusBar.dataset.type = type;
  statusBar.classList.toggle("is-visible", Boolean(message));

  if (message) {
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
      statusBar.classList.remove("is-visible");
    }, 3500);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
