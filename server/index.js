import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  GAME_LIMITS,
  Lucky9Error,
  addPlayer,
  appendLog,
  autoPlayTurn,
  buildClientState,
  createSession,
  declareShow,
  discardCards,
  drawCard,
  endTurn,
  markPlayerConnected,
  markPlayerDisconnected,
  prepareNextRound,
  removeDisconnectedPlayer,
  setPlayerReady
} from "../shared/gameEngine.js";

const PORT = Number(process.env.PORT || 4179);
const PUBLIC_DIR = resolve(process.cwd(), "public");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const NEXT_ROUND_DELAY_MS = 8_000;

const sessions = new Map();
const connections = new Map();
const disconnectTimers = new Map();
const nextRoundTimers = new Map();
const turnTimers = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Lucky 9 server running at http://localhost:${PORT}`);
});

async function routeRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    sendEmpty(res, 204);
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/sessions" && req.method === "POST") {
    const body = await readJson(req);
    const playerId = randomUUID();
    const code = createSessionCode();
    const session = createSession({
      code,
      hostId: playerId,
      hostName: body.playerName
    });

    sessions.set(code, session);
    sendJson(res, 201, {
      code,
      playerId,
      state: buildClientState(session, playerId)
    });
    return;
  }

  const sessionRoute = url.pathname.match(/^\/api\/sessions\/([A-Z0-9]{4,8})(?:\/([a-z-]+))?$/);

  if (sessionRoute) {
    const code = sessionRoute[1];
    const action = sessionRoute[2] || "state";
    await routeSessionAction(req, res, code, action, url);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(url.pathname, req, res);
    return;
  }

  throw new Lucky9Error("Route not found.", 404, "NOT_FOUND");
}

async function routeSessionAction(req, res, code, action, url) {
  const session = requireSession(code);

  if (action === "join" && req.method === "POST") {
    const body = await readJson(req);
    const playerId = randomUUID();
    addPlayer(session, { id: playerId, name: body.playerName });
    broadcastSession(session);

    sendJson(res, 201, {
      code,
      playerId,
      state: buildClientState(session, playerId)
    });
    return;
  }

  if (action === "state" && req.method === "GET") {
    const playerId = url.searchParams.get("playerId");
    assertKnownViewer(session, playerId);
    sendJson(res, 200, { state: buildClientState(session, playerId) });
    return;
  }

  if (action === "events" && req.method === "GET") {
    const playerId = url.searchParams.get("playerId");
    assertKnownViewer(session, playerId);
    openEventStream(session, playerId, res);
    return;
  }

  const body = req.method === "POST" ? await readJson(req) : {};
  const playerId = body.playerId;
  assertKnownViewer(session, playerId);

  if (action === "ready" && req.method === "POST") {
    setPlayerReady(session, playerId, body.ready);
    broadcastSession(session);
    scheduleTurnTimer(session);
    sendJson(res, 200, { state: buildClientState(session, playerId) });
    return;
  }

  if (action === "discard" && req.method === "POST") {
    discardCards(session, playerId, body.cardIds);
    broadcastSession(session);
    sendJson(res, 200, { state: buildClientState(session, playerId) });
    return;
  }

  if (action === "draw" && req.method === "POST") {
    drawCard(session, playerId, body.source);
    broadcastSession(session);
    scheduleTurnTimer(session);
    sendJson(res, 200, { state: buildClientState(session, playerId) });
    return;
  }

  if (action === "show" && req.method === "POST") {
    declareShow(session, playerId);
    broadcastSession(session);
    scheduleTurnTimer(session);
    scheduleNextRound(session);
    sendJson(res, 200, { state: buildClientState(session, playerId) });
    return;
  }

  if (action === "end-turn" && req.method === "POST") {
    endTurn(session, playerId);
    broadcastSession(session);
    scheduleTurnTimer(session);
    sendJson(res, 200, { state: buildClientState(session, playerId) });
    return;
  }

  throw new Lucky9Error("Route not found.", 404, "NOT_FOUND");
}

function openEventStream(session, playerId, res) {
  const player = session.players.find((candidate) => candidate.id === playerId);
  const timerKey = connectionKey(session.code, playerId);

  if (!player.connected) {
    markPlayerConnected(session, playerId);
    broadcastSession(session);
  }

  clearTimer(disconnectTimers, timerKey);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no"
  });

  addConnection(session.code, playerId, res);
  writeEvent(res, "state", buildClientState(session, playerId));

  const keepAlive = setInterval(() => {
    if (!res.destroyed) {
      res.write(": keep-alive\n\n");
    }
  }, 20_000);

  res.on("close", () => {
    clearInterval(keepAlive);
    removeConnection(session.code, playerId, res);

    if (!hasOpenConnections(session.code, playerId) && sessions.has(session.code)) {
      markPlayerDisconnected(session, playerId);
      broadcastSession(session);
      scheduleDisconnectRemoval(session, playerId);
    }
  });
}

function scheduleDisconnectRemoval(session, playerId) {
  const key = connectionKey(session.code, playerId);
  clearTimer(disconnectTimers, key);

  disconnectTimers.set(
    key,
    setTimeout(() => {
      disconnectTimers.delete(key);

      if (!sessions.has(session.code) || hasOpenConnections(session.code, playerId)) {
        return;
      }

      const removed = removeDisconnectedPlayer(session, playerId);

      if (removed) {
        broadcastSession(session);
        scheduleNextRound(session);
        scheduleTurnTimer(session);
      }
    }, GAME_LIMITS.reconnectGraceMs)
  );
}

function scheduleNextRound(session) {
  clearTimer(nextRoundTimers, session.code);

  if (session.status !== "round_over" || session.winnerId) {
    return;
  }

  nextRoundTimers.set(
    session.code,
    setTimeout(() => {
      nextRoundTimers.delete(session.code);

      if (!sessions.has(session.code) || session.status !== "round_over" || session.winnerId) {
        return;
      }

      try {
        prepareNextRound(session);
        scheduleTurnTimer(session);
      } catch (error) {
        appendLog(session, error.message);
        scheduleNextRound(session);
      }

      broadcastSession(session);
    }, NEXT_ROUND_DELAY_MS)
  );
}

function scheduleTurnTimer(session) {
  clearTimer(turnTimers, session.code);

  if (session.status !== "playing" || session.round?.status !== "active") {
    return;
  }

  const delay = Math.max(0, session.round.turnEndsAt - Date.now());

  turnTimers.set(
    session.code,
    setTimeout(() => {
      turnTimers.delete(session.code);

      if (!sessions.has(session.code) || session.status !== "playing" || session.round?.status !== "active") {
        return;
      }

      try {
        autoPlayTurn(session);
      } catch (error) {
        appendLog(session, error.message);
      }

      broadcastSession(session);
      scheduleNextRound(session);
      scheduleTurnTimer(session);
    }, delay)
  );
}

function broadcastSession(session) {
  const sessionConnections = connections.get(session.code);

  if (!sessionConnections) {
    return;
  }

  for (const [playerId, playerConnections] of sessionConnections) {
    for (const res of playerConnections) {
      writeEvent(res, "state", buildClientState(session, playerId));
    }
  }
}

function addConnection(code, playerId, res) {
  if (!connections.has(code)) {
    connections.set(code, new Map());
  }

  const sessionConnections = connections.get(code);

  if (!sessionConnections.has(playerId)) {
    sessionConnections.set(playerId, new Set());
  }

  sessionConnections.get(playerId).add(res);
}

function removeConnection(code, playerId, res) {
  const sessionConnections = connections.get(code);
  const playerConnections = sessionConnections?.get(playerId);

  if (!playerConnections) {
    return;
  }

  playerConnections.delete(res);

  if (playerConnections.size === 0) {
    sessionConnections.delete(playerId);
  }

  if (sessionConnections.size === 0) {
    connections.delete(code);
  }
}

function hasOpenConnections(code, playerId) {
  return (connections.get(code)?.get(playerId)?.size ?? 0) > 0;
}

function writeEvent(res, event, data) {
  if (res.destroyed) {
    return;
  }

  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function requireSession(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const session = sessions.get(normalized);

  if (!session) {
    throw new Lucky9Error("No active session was found for that code.", 404, "SESSION_NOT_FOUND");
  }

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(normalized);
    throw new Lucky9Error("That session has expired. Please create a new game.", 410, "SESSION_EXPIRED");
  }

  return session;
}

function assertKnownViewer(session, playerId) {
  if (!playerId || !session.players.some((player) => player.id === playerId && !player.removed)) {
    throw new Lucky9Error("Unknown player for this session.", 403, "UNKNOWN_VIEWER");
  }
}

async function readJson(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > 1_000_000) {
      throw new Lucky9Error("Request body is too large.", 413, "BODY_TOO_LARGE");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Lucky9Error("Request body must be valid JSON.", 400, "INVALID_JSON");
  }
}

function serveStatic(pathname, req, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw new Lucky9Error("Route not found.", 404, "NOT_FOUND");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Lucky9Error("Route not found.", 404, "NOT_FOUND");
  }

  res.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": requested === "/service-worker.js" ? "no-store" : "public, max-age=300"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end();
}

function sendError(res, error) {
  const status = error instanceof Lucky9Error ? error.status : 500;
  const code = error instanceof Lucky9Error ? error.code : "INTERNAL_ERROR";
  const message =
    error instanceof Lucky9Error ? error.message : "Something went wrong while handling the request.";

  if (status >= 500) {
    console.error(error);
  }

  sendJson(res, status, { error: { code, message } });
}

function createSessionCode() {
  let code;

  do {
    code = randomBytes(4)
      .toString("base64url")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase()
      .slice(0, 6)
      .padEnd(6, "9");
  } while (sessions.has(code));

  return code;
}

function connectionKey(code, playerId) {
  return `${code}:${playerId}`;
}

function clearTimer(map, key) {
  const timer = map.get(key);

  if (timer) {
    clearTimeout(timer);
    map.delete(key);
  }
}
