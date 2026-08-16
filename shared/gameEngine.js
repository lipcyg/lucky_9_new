export const GAME_LIMITS = Object.freeze({
  minPlayers: 2,
  maxPlayers: 6,
  reconnectGraceMs: 60_000,
  turnMs: 30_000,
  scoreLimit: 100
});

export const RANKS = Object.freeze([
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
]);

export const SUITS = Object.freeze(["H", "D", "C", "S"]);

export class Lucky9Error extends Error {
  constructor(message, status = 400, code = "LUCKY9_ERROR") {
    super(message);
    this.name = "Lucky9Error";
    this.status = status;
    this.code = code;
  }
}

export function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${rank}-${suit}`,
        rank,
        suit
      });
    }
  }

  return deck;
}

export function cardValue(card) {
  if (card.rank === "A") {
    return 1;
  }

  if (card.rank === "J") {
    return 11;
  }

  if (card.rank === "Q") {
    return 12;
  }

  if (card.rank === "K") {
    return 13;
  }

  return Number(card.rank);
}

export function handTotal(hand) {
  return hand.reduce((total, card) => total + cardValue(card), 0);
}

export function shuffleDeck(cards, random = Math.random) {
  const shuffled = cards.slice();

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function createPlayer({ id, name, host = false, now = Date.now() }) {
  return {
    id,
    name: normalizeName(name),
    host,
    ready: false,
    connected: true,
    disconnectedAt: null,
    removed: false,
    eliminated: false,
    score: 0,
    joinedAt: now
  };
}

export function createSession({ code, hostId, hostName, now = Date.now() }) {
  const session = {
    code,
    hostId,
    status: "lobby",
    createdAt: now,
    updatedAt: now,
    roundNumber: 0,
    players: [createPlayer({ id: hostId, name: hostName, host: true, now })],
    round: null,
    winnerId: null,
    logs: []
  };

  logEvent(session, `${normalizeName(hostName)} created session ${code}.`, now);
  return session;
}

export function addPlayer(session, { id, name, now = Date.now() }) {
  assertSessionJoinable(session);

  if (session.players.some((player) => player.id === id)) {
    throw new Lucky9Error("That player is already in this session.", 409, "DUPLICATE_PLAYER");
  }

  const player = createPlayer({ id, name, now });
  session.players.push(player);
  touch(session, now);
  logEvent(session, `${player.name} joined the session.`, now);
  return player;
}

export function markPlayerConnected(session, playerId, now = Date.now()) {
  const player = requirePlayer(session, playerId);

  if (player.removed) {
    throw new Lucky9Error("This player has been removed from the session.", 410, "PLAYER_REMOVED");
  }

  player.connected = true;
  player.disconnectedAt = null;
  touch(session, now);
  logEvent(session, `${player.name} reconnected.`, now);
}

export function markPlayerDisconnected(session, playerId, now = Date.now()) {
  const player = requirePlayer(session, playerId);

  if (player.removed || !player.connected) {
    return;
  }

  player.connected = false;
  player.disconnectedAt = now;
  touch(session, now);

  const turnSuffix =
    session.round?.status === "active" && session.round.currentPlayerId === playerId
      ? " Their turn remains on the 30-second timer."
      : "";

  logEvent(session, `${player.name} disconnected.${turnSuffix}`, now);
}

export function removeDisconnectedPlayer(session, playerId, now = Date.now()) {
  const player = requirePlayer(session, playerId);

  if (player.connected || player.removed) {
    return false;
  }

  player.removed = true;
  player.ready = false;
  player.disconnectedAt = player.disconnectedAt ?? now;

  if (session.round) {
    session.round.turnOrder = session.round.turnOrder.filter((id) => id !== playerId);

    if (session.round.currentPlayerId === playerId && session.round.status === "active") {
      advanceTurn(session, { now, force: true });
    }
  }

  touch(session, now);
  logEvent(session, `${player.name} was removed after 60 seconds offline.`, now);
  concludeGameIfNeeded(session, session.players.filter((candidate) => !candidate.removed), now);
  return true;
}

export function setPlayerReady(session, playerId, ready, now = Date.now()) {
  if (session.status !== "lobby") {
    throw new Lucky9Error("Readiness can only be changed before the game starts.", 409, "GAME_STARTED");
  }

  const player = requirePlayer(session, playerId);

  if (player.removed) {
    throw new Lucky9Error("Removed players cannot ready up.", 410, "PLAYER_REMOVED");
  }

  player.ready = Boolean(ready);
  touch(session, now);
  logEvent(session, `${player.name} is ${player.ready ? "ready" : "not ready"}.`, now);

  if (canStartGame(session)) {
    startGame(session, now);
  }
}

export function canStartGame(session) {
  const players = lobbyPlayers(session);

  return (
    session.status === "lobby" &&
    players.length >= GAME_LIMITS.minPlayers &&
    players.length <= GAME_LIMITS.maxPlayers &&
    players.every((player) => player.connected && player.ready)
  );
}

export function startGame(session, now = Date.now(), random = Math.random) {
  if (!canStartGame(session)) {
    throw new Lucky9Error(
      "A game needs 2 to 6 connected and ready players before it can start.",
      409,
      "NOT_READY"
    );
  }

  for (const player of session.players) {
    player.score = 0;
    player.eliminated = false;
  }

  session.winnerId = null;
  logEvent(session, "All players are ready. The game is starting.", now);
  return startRound(session, now, random);
}

export function startRound(session, now = Date.now(), random = Math.random) {
  const active = activePlayers(session);

  if (active.length < GAME_LIMITS.minPlayers) {
    concludeGameIfNeeded(session, active, now);
    return session.round;
  }

  if (!active.every((player) => player.connected)) {
    throw new Lucky9Error("A new round can only start when all active players are connected.", 409, "PLAYERS_OFFLINE");
  }

  const deck = shuffleDeck(createDeck(), random);
  const hands = {};

  for (const player of active) {
    hands[player.id] = [];
  }

  for (let cardIndex = 0; cardIndex < 4; cardIndex += 1) {
    for (const player of active) {
      hands[player.id].push(deck.pop());
    }
  }

  const openPile = [deck.pop()];
  const drawStack = deck;

  session.roundNumber += 1;
  session.status = "playing";
  session.round = {
    number: session.roundNumber,
    status: "active",
    startedAt: now,
    turnOrder: active.map((player) => player.id),
    turnIndex: 0,
    currentPlayerId: active[0].id,
    turnStartedAt: now,
    turnEndsAt: now + GAME_LIMITS.turnMs,
    phase: "discard",
    drawStack,
    openPile,
    pendingDiscard: null,
    hands,
    revealed: false,
    shownBy: null,
    totals: null,
    scoring: null,
    recycleCount: 0
  };

  touch(session, now);
  logEvent(session, `Round ${session.round.number} started. ${active[0].name} takes the first turn.`, now);
  return session.round;
}

export function discardCards(session, playerId, cardIds, now = Date.now(), options = {}) {
  const round = requireActiveTurn(session, playerId, "discard", options);
  const hand = round.hands[playerId] ?? [];
  const cards = requireCardsFromHand(hand, cardIds);

  if (!isValidDiscard(cards)) {
    throw new Lucky9Error(
      "Discard must be one card, a pair, three of a kind, four of a kind, or two pairs.",
      422,
      "INVALID_DISCARD"
    );
  }

  const discardIds = new Set(cardIds);
  round.hands[playerId] = hand.filter((card) => !discardIds.has(card.id));
  round.pendingDiscard = {
    playerId,
    openPileStartIndex: round.openPile.length,
    cardIds: cards.map((card) => card.id)
  };
  round.openPile.push(...cards);
  round.phase = "draw";

  touch(session, now);
  logEvent(session, `${playerName(session, playerId)} discarded ${describeCards(cards)}.`, now);
  return cards;
}

export function drawCard(session, playerId, source, now = Date.now(), random = Math.random, options = {}) {
  const round = requireActiveTurn(session, playerId, "draw", options);
  let card;

  if (source === "drawStack") {
    if (round.drawStack.length === 0) {
      recycleOpenPile(session, now, random);
    }

    card = round.drawStack.pop();
  } else if (source === "openPile") {
    const drawIndex = openPileDrawIndex(round, playerId);

    if (drawIndex < 0) {
      throw new Lucky9Error("There are no previous open-pile cards available to draw.", 409, "EMPTY_PILE");
    }

    card = round.openPile.splice(drawIndex, 1)[0];
  } else {
    throw new Lucky9Error("Draw source must be drawStack or openPile.", 422, "INVALID_DRAW_SOURCE");
  }

  if (!card) {
    throw new Lucky9Error("There are no cards available from that pile.", 409, "EMPTY_PILE");
  }

  round.hands[playerId].push(card);
  round.pendingDiscard = null;
  round.phase = "show_or_end";

  touch(session, now);
  logEvent(
    session,
    `${playerName(session, playerId)} drew 1 card from ${source === "drawStack" ? "the draw stack" : "the open pile"}.`,
    now
  );
  advanceTurn(session, { now });
  return card;
}

export function endTurn(session, playerId, now = Date.now()) {
  requireActiveTurn(session, playerId, "show_or_end");
  advanceTurn(session, { now });
}

export function declareShow(session, playerId, now = Date.now()) {
  const round = requireShowTurn(session, playerId);
  const showingTotal = handTotal(round.hands[playerId]);

  if (showingTotal > 9) {
    throw new Lucky9Error("You can only show when your hand total is 9 or less.", 422, "SHOW_TOTAL_TOO_HIGH");
  }

  const participants = session.players.filter(
    (player) => !player.removed && Object.hasOwn(round.hands, player.id)
  );

  const totals = Object.fromEntries(
    participants.map((player) => [player.id, handTotal(round.hands[player.id])])
  );

  const failed = participants.some(
    (player) => player.id !== playerId && totals[player.id] <= showingTotal
  );
  const deltas = {};

  for (const player of participants) {
    if (player.id === playerId) {
      deltas[player.id] = failed ? 50 : 0;
    } else if (failed) {
      deltas[player.id] = totals[player.id] < showingTotal ? -5 : 0;
    } else {
      deltas[player.id] = totals[player.id];
    }
  }

  for (const player of participants) {
    player.score += deltas[player.id];
  }

  for (const player of participants) {
    if (player.score > GAME_LIMITS.scoreLimit) {
      player.eliminated = true;
    }
  }

  round.status = "complete";
  round.phase = "round_over";
  round.revealed = true;
  round.shownBy = playerId;
  round.totals = totals;
  round.scoring = {
    failed,
    showingPlayerId: playerId,
    showingTotal,
    deltas
  };

  session.status = "round_over";
  touch(session, now);

  logEvent(
    session,
    `${playerName(session, playerId)} showed ${showingTotal}. The show ${failed ? "failed" : "succeeded"}.`,
    now
  );

  for (const player of participants) {
    if (player.eliminated) {
      logEvent(session, `${player.name} was eliminated with ${player.score} points.`, now);
    }
  }

  concludeGameIfNeeded(session, participants, now);
  return round.scoring;
}

export function prepareNextRound(session, now = Date.now(), random = Math.random) {
  if (session.status !== "round_over") {
    throw new Lucky9Error("The next round can only start after scoring is complete.", 409, "ROUND_NOT_OVER");
  }

  return startRound(session, now, random);
}

export function autoPlayTurn(session, now = Date.now(), random = Math.random) {
  const round = session.round;

  if (!round || round.status !== "active") {
    return false;
  }

  const playerId = round.currentPlayerId;
  const player = requirePlayer(session, playerId);

  if (player.removed || player.eliminated) {
    advanceTurn(session, { now, force: true });
    return true;
  }

  if (round.phase === "discard") {
    const hand = round.hands[playerId] ?? [];

    if (hand.length === 0) {
      throw new Lucky9Error("The current player has no card to auto-discard.", 409, "EMPTY_HAND");
    }

    const discard = hand.slice().sort((left, right) => cardValue(right) - cardValue(left))[0];
    discardCards(session, playerId, [discard.id], now, { allowDisconnected: true });
  }

  if (round.phase === "draw") {
    try {
      drawCard(session, playerId, "drawStack", now, random, { allowDisconnected: true });
    } catch (error) {
      if (error instanceof Lucky9Error && error.code === "NO_CARDS_TO_RECYCLE" && openPileDrawIndex(round, playerId) >= 0) {
        drawCard(session, playerId, "openPile", now, random, { allowDisconnected: true });
      } else {
        throw error;
      }
    }
  } else if (round.phase === "show_or_end") {
    advanceTurn(session, { now });
  }

  logEvent(session, `${player.name}'s turn was auto-played after 30 seconds.`, now);
  return true;
}

export function isValidDiscard(cards) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4) {
    return false;
  }

  const counts = new Map();

  for (const card of cards) {
    const value = cardValue(card);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const pattern = [...counts.values()].sort((a, b) => a - b).join(",");

  if (cards.length === 1) {
    return true;
  }

  if (cards.length === 2) {
    return pattern === "2";
  }

  if (cards.length === 3) {
    return pattern === "3";
  }

  return pattern === "4" || pattern === "2,2";
}

export function buildClientState(session, viewerId) {
  const viewer = session.players.find((player) => player.id === viewerId);
  const round = session.round;

  const state = {
    code: session.code,
    status: session.status,
    hostId: session.hostId,
    viewerId,
    viewerKnown: Boolean(viewer && !viewer.removed),
    winnerId: session.winnerId,
    updatedAt: session.updatedAt,
    players: session.players.map((player) => ({
      id: player.id,
      name: player.name,
      host: player.host,
      ready: player.ready,
      connected: player.connected,
      removed: player.removed,
      eliminated: player.eliminated,
      score: player.score,
      isViewer: player.id === viewerId
    })),
    logs: session.logs.slice(-30)
  };

  if (!round) {
    state.round = null;
    return state;
  }

  const hands = {};

  for (const player of session.players) {
    if (!Object.hasOwn(round.hands, player.id)) {
      continue;
    }

    const hand = round.hands[player.id];
    const visible = player.id === viewerId || round.revealed;

    hands[player.id] = visible
      ? {
          hidden: false,
          count: hand.length,
          total: handTotal(hand),
          cards: hand.map((card) => ({ ...card, value: cardValue(card) }))
        }
      : {
          hidden: true,
          count: hand.length
        };
  }

  state.round = {
    number: round.number,
    status: round.status,
    phase: round.phase,
    currentPlayerId: round.currentPlayerId,
    currentPlayerName: playerName(session, round.currentPlayerId),
    turnStartedAt: round.turnStartedAt,
    turnEndsAt: round.turnEndsAt,
    turnDurationMs: GAME_LIMITS.turnMs,
    drawStackCount: round.drawStack.length,
    openPileCount: round.openPile.length,
    openPileTop: visibleOpenPileTop(round),
    openPileRecent: round.openPile.slice(-5).map((card) => ({ ...card, value: cardValue(card) })),
    revealed: round.revealed,
    shownBy: round.shownBy,
    totals: round.totals,
    scoring: round.scoring,
    recycleCount: round.recycleCount,
    hands
  };

  return state;
}

export function appendLog(session, message, now = Date.now()) {
  touch(session, now);
  logEvent(session, message, now);
}

export function lobbyPlayers(session) {
  return session.players.filter((player) => !player.removed);
}

export function activePlayers(session) {
  return session.players.filter((player) => !player.removed && !player.eliminated);
}

function assertSessionJoinable(session) {
  if (session.status !== "lobby") {
    throw new Lucky9Error("This session is already in progress.", 409, "SESSION_IN_PROGRESS");
  }

  if (lobbyPlayers(session).length >= GAME_LIMITS.maxPlayers) {
    throw new Lucky9Error("This session already has 6 players.", 409, "SESSION_FULL");
  }
}

function advanceTurn(session, { now = Date.now(), force = false } = {}) {
  const round = session.round;

  if (!round || round.status !== "active") {
    return;
  }

  if (!force && round.phase !== "show_or_end") {
    throw new Lucky9Error("A turn can only end after discarding and drawing.", 409, "TURN_INCOMPLETE");
  }

  round.turnOrder = round.turnOrder.filter((id) => {
    const player = session.players.find((candidate) => candidate.id === id);
    return player && !player.removed && !player.eliminated;
  });

  if (round.turnOrder.length < GAME_LIMITS.minPlayers) {
    concludeGameIfNeeded(session, activePlayers(session), now);
    return;
  }

  const currentIndex = round.turnOrder.indexOf(round.currentPlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % round.turnOrder.length;

  round.turnIndex = nextIndex;
  round.currentPlayerId = round.turnOrder[nextIndex];
  round.turnStartedAt = now;
  round.turnEndsAt = now + GAME_LIMITS.turnMs;
  round.phase = "discard";

  touch(session, now);
  logEvent(session, `It is now ${playerName(session, round.currentPlayerId)}'s turn.`, now);
}

function recycleOpenPile(session, now, random) {
  const round = session.round;

  if (round.pendingDiscard) {
    const preserved = round.openPile.slice(round.pendingDiscard.openPileStartIndex);
    const recyclable = round.openPile.slice(0, round.pendingDiscard.openPileStartIndex);

    if (recyclable.length === 0) {
      throw new Lucky9Error(
        "The draw stack is empty and there are no covered open-pile cards to recycle.",
        409,
        "NO_CARDS_TO_RECYCLE"
      );
    }

    round.drawStack = shuffleDeck(recyclable, random);
    round.openPile = preserved;
    round.pendingDiscard.openPileStartIndex = 0;
    round.recycleCount += 1;

    touch(session, now);
    logEvent(session, "The draw stack was rebuilt from the open pile.", now);
    return;
  }

  if (round.openPile.length <= 1) {
    throw new Lucky9Error(
      "The draw stack is empty and there are no covered open-pile cards to recycle.",
      409,
      "NO_CARDS_TO_RECYCLE"
    );
  }

  const topCard = round.openPile.pop();
  round.drawStack = shuffleDeck(round.openPile, random);
  round.openPile = [topCard];
  round.recycleCount += 1;

  touch(session, now);
  logEvent(session, "The draw stack was rebuilt from the open pile.", now);
}

function openPileDrawIndex(round, playerId) {
  if (
    round.pendingDiscard &&
    round.pendingDiscard.playerId === playerId &&
    round.phase === "draw"
  ) {
    return round.pendingDiscard.openPileStartIndex - 1;
  }

  return round.openPile.length - 1;
}

function visibleOpenPileTop(round) {
  const drawIndex = openPileDrawIndex(round, round.currentPlayerId);
  const card = drawIndex >= 0 ? round.openPile[drawIndex] : null;

  return card ? { ...card, value: cardValue(card) } : null;
}

function concludeGameIfNeeded(session, participants, now) {
  if (session.status === "lobby" || session.status === "finished") {
    return;
  }

  const remaining = activePlayers(session);

  if (remaining.length === 1) {
    session.status = "finished";
    session.winnerId = remaining[0].id;
    logEvent(session, `${remaining[0].name} wins the game.`, now);
    touch(session, now);
    return;
  }

  if (remaining.length === 0 && participants.length > 0) {
    const winner = participants
      .slice()
      .sort((left, right) => left.score - right.score || left.joinedAt - right.joinedAt)[0];

    session.status = "finished";
    session.winnerId = winner.id;
    logEvent(session, `${winner.name} wins with the lowest score.`, now);
    touch(session, now);
  }
}

function requireShowTurn(session, playerId) {
  const round = session.round;

  if (!round || round.status !== "active") {
    throw new Lucky9Error("There is no active round.", 409, "NO_ACTIVE_ROUND");
  }

  if (round.currentPlayerId !== playerId) {
    throw new Lucky9Error("It is not your turn.", 403, "NOT_YOUR_TURN");
  }

  const player = requirePlayer(session, playerId);

  if (!player.connected) {
    throw new Lucky9Error("This player is disconnected.", 409, "PLAYER_DISCONNECTED");
  }

  if (player.removed || player.eliminated) {
    throw new Lucky9Error("This player is not active.", 409, "PLAYER_INACTIVE");
  }

  if (round.phase !== "discard" && round.phase !== "show_or_end") {
    throw new Lucky9Error("Show is only available at the start of your turn.", 409, "WRONG_TURN_PHASE");
  }

  return round;
}

function requireActiveTurn(session, playerId, phase, options = {}) {
  const round = session.round;

  if (!round || round.status !== "active") {
    throw new Lucky9Error("There is no active round.", 409, "NO_ACTIVE_ROUND");
  }

  if (round.currentPlayerId !== playerId) {
    throw new Lucky9Error("It is not your turn.", 403, "NOT_YOUR_TURN");
  }

  const player = requirePlayer(session, playerId);

  if (!player.connected && !options.allowDisconnected) {
    throw new Lucky9Error("This player is disconnected.", 409, "PLAYER_DISCONNECTED");
  }

  if (player.removed || player.eliminated) {
    throw new Lucky9Error("This player is not active.", 409, "PLAYER_INACTIVE");
  }

  if (round.phase !== phase) {
    throw new Lucky9Error(`This action is only available during the ${phase} phase.`, 409, "WRONG_TURN_PHASE");
  }

  return round;
}

function requireCardsFromHand(hand, cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    throw new Lucky9Error("Choose at least one card to discard.", 422, "NO_CARDS_SELECTED");
  }

  const uniqueIds = new Set(cardIds);

  if (uniqueIds.size !== cardIds.length) {
    throw new Lucky9Error("Discarded cards must be unique.", 422, "DUPLICATE_CARD");
  }

  const byId = new Map(hand.map((card) => [card.id, card]));
  const cards = [];

  for (const cardId of cardIds) {
    const card = byId.get(cardId);

    if (!card) {
      throw new Lucky9Error("One or more discarded cards are not in your hand.", 422, "CARD_NOT_IN_HAND");
    }

    cards.push(card);
  }

  return cards;
}

function requirePlayer(session, playerId) {
  const player = session.players.find((candidate) => candidate.id === playerId);

  if (!player) {
    throw new Lucky9Error("Unknown player.", 404, "UNKNOWN_PLAYER");
  }

  return player;
}

function playerName(session, playerId) {
  return session.players.find((player) => player.id === playerId)?.name ?? "Unknown player";
}

function describeCards(cards) {
  return cards.map((card) => `${card.rank}${card.suit}`).join(", ");
}

function normalizeName(name) {
  const cleaned = String(name ?? "").trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 24) || "Player";
}

function touch(session, now) {
  session.updatedAt = now;
}

function logEvent(session, message, now) {
  session.logs.push({ at: now, message });

  if (session.logs.length > 100) {
    session.logs.splice(0, session.logs.length - 100);
  }
}
