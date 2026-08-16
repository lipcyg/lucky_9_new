import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  autoPlayTurn,
  buildClientState,
  cardValue,
  createSession,
  declareShow,
  discardCards,
  drawCard,
  handTotal,
  isValidDiscard,
  markPlayerDisconnected,
  removeDisconnectedPlayer,
  setPlayerReady
} from "../shared/gameEngine.js";

test("card values and hand totals follow Lucky 9 rules", () => {
  assert.equal(cardValue(card("A", "H")), 1);
  assert.equal(cardValue(card("7", "C")), 7);
  assert.equal(cardValue(card("10", "S")), 10);
  assert.equal(cardValue(card("J", "D")), 11);
  assert.equal(cardValue(card("Q", "D")), 12);
  assert.equal(cardValue(card("K", "D")), 13);
  assert.equal(handTotal([card("A", "H"), card("9", "D"), card("K", "C")]), 23);
});

test("valid discard patterns are enforced", () => {
  assert.equal(isValidDiscard([card("A", "H")]), true);
  assert.equal(isValidDiscard([card("5", "H"), card("5", "D")]), true);
  assert.equal(isValidDiscard([card("8", "H"), card("8", "D"), card("8", "C")]), true);
  assert.equal(isValidDiscard([card("Q", "H"), card("Q", "D"), card("Q", "C"), card("Q", "S")]), true);
  assert.equal(isValidDiscard([card("2", "H"), card("2", "D"), card("7", "C"), card("7", "S")]), true);
  assert.equal(isValidDiscard([card("2", "H"), card("3", "D")]), false);
  assert.equal(isValidDiscard([card("2", "H"), card("2", "D"), card("3", "C"), card("4", "S")]), false);
});

test("round setup deals four cards, opens one card, and hides the draw stack", () => {
  const session = readySession(3);

  assert.equal(session.status, "playing");
  assert.equal(session.round.number, 1);
  assert.equal(session.round.openPile.length, 1);
  assert.equal(session.round.drawStack.length, 52 - 3 * 4 - 1);
  assert.equal(session.round.hands.p1.length, 4);
  assert.equal(session.round.hands.p2.length, 4);
  assert.equal(session.round.hands.p3.length, 4);

  const p1View = buildClientState(session, "p1");
  assert.equal(p1View.round.hands.p1.hidden, false);
  assert.equal(p1View.round.hands.p2.hidden, true);
  assert.equal(p1View.round.hands.p2.cards, undefined);
  assert.equal(p1View.round.drawStack, undefined);
  assert.equal(p1View.round.drawStackCount, session.round.drawStack.length);
});

test("turn flow requires discard before draw and rejects other players", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p1";
  session.round.phase = "discard";
  session.round.hands.p1 = [card("4", "H"), card("4", "D"), card("9", "C")];
  session.round.drawStack = [card("A", "S")];

  assert.throws(() => drawCard(session, "p1", "drawStack"), /draw phase/);
  assert.throws(() => discardCards(session, "p2", [session.round.hands.p2[0].id]), /not your turn/i);
  assert.throws(() => discardCards(session, "p1", ["4-H", "9-C"]), /Discard must/);

  discardCards(session, "p1", ["4-H", "4-D"]);
  assert.equal(session.round.hands.p1.length, 1);
  assert.equal(session.round.phase, "draw");

  drawCard(session, "p1", "drawStack");
  assert.equal(session.round.hands.p1.length, 2);
  assert.equal(session.round.currentPlayerId, "p2");
  assert.equal(session.round.phase, "discard");
});

test("open-pile draw takes the previous card instead of the card just discarded", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p1";
  session.round.phase = "discard";
  session.round.hands.p1 = [card("4", "H"), card("9", "C")];
  session.round.openPile = [card("6", "D")];

  discardCards(session, "p1", ["4-H"]);
  let p1View = buildClientState(session, "p1");
  assert.equal(p1View.round.openPileTop.id, "6-D");

  drawCard(session, "p1", "openPile");

  assert.deepEqual(
    session.round.hands.p1.map((held) => held.id).sort(),
    ["6-D", "9-C"]
  );
  assert.equal(session.round.openPile.at(-1).id, "4-H");
  assert.equal(session.round.currentPlayerId, "p2");

  const p2View = buildClientState(session, "p2");
  assert.equal(p2View.round.openPileTop.id, "4-H");
});

test("two-pair discards remain available on the open pile for the next player", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p1";
  session.round.phase = "discard";
  session.round.hands.p1 = [card("4", "H"), card("4", "D"), card("9", "C"), card("9", "S")];
  session.round.openPile = [card("6", "D")];
  session.round.drawStack = [card("A", "S")];

  discardCards(session, "p1", ["4-H", "4-D", "9-C", "9-S"]);
  drawCard(session, "p1", "drawStack");

  assert.equal(session.round.currentPlayerId, "p2");
  assert.equal(buildClientState(session, "p2").round.openPileTop.id, "9-S");
});

test("draw stack recycles the open pile without exposing the top open card", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p1";
  session.round.phase = "draw";
  session.round.hands.p1 = [card("3", "H")];
  session.round.drawStack = [];
  session.round.openPile = [card("5", "C"), card("6", "D"), card("9", "S")];

  drawCard(session, "p1", "drawStack", Date.now(), () => 0);

  assert.equal(session.round.openPile.length, 1);
  assert.equal(session.round.openPile[0].id, "9-S");
  assert.equal(session.round.drawStack.length, 1);
  assert.equal(session.round.recycleCount, 1);
  assert.equal(session.round.hands.p1.length, 2);
});

test("turns include a 30 second deadline and autoplay on timeout", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p1";
  session.round.phase = "discard";
  session.round.turnStartedAt = 100;
  session.round.turnEndsAt = 30_100;
  session.round.hands.p1 = [card("4", "H"), card("K", "D")];
  session.round.drawStack = [card("A", "S")];
  session.round.openPile = [card("6", "D")];

  autoPlayTurn(session, 30_101);

  assert.equal(session.round.currentPlayerId, "p2");
  assert.equal(session.round.phase, "discard");
  assert.equal(session.round.openPile.at(-1).id, "K-D");
  assert.deepEqual(
    session.round.hands.p1.map((held) => held.id).sort(),
    ["4-H", "A-S"]
  );
  assert.equal(session.round.turnEndsAt, 60_101);
});

test("successful show scores other players and reveals hands", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p1";
  session.round.phase = "show_or_end";
  session.round.hands.p1 = [card("4", "H"), card("5", "D")];
  session.round.hands.p2 = [card("K", "C")];

  const scoring = declareShow(session, "p1");

  assert.equal(scoring.failed, false);
  assert.equal(session.players.find((player) => player.id === "p1").score, 0);
  assert.equal(session.players.find((player) => player.id === "p2").score, 13);
  assert.equal(session.status, "round_over");

  const p1View = buildClientState(session, "p1");
  assert.equal(p1View.round.hands.p2.hidden, false);
  assert.equal(p1View.round.hands.p2.total, 13);
});

test("failed show penalizes the showing player and rewards lower totals", () => {
  const session = readySession(3);
  session.round.currentPlayerId = "p1";
  session.round.phase = "show_or_end";
  session.round.hands.p1 = [card("4", "H"), card("5", "D")];
  session.round.hands.p2 = [card("9", "C")];
  session.round.hands.p3 = [card("7", "S")];

  const scoring = declareShow(session, "p1");

  assert.equal(scoring.failed, true);
  assert.deepEqual(scoring.deltas, {
    p1: 50,
    p2: 0,
    p3: -5
  });
  assert.equal(session.players.find((player) => player.id === "p1").score, 50);
  assert.equal(session.players.find((player) => player.id === "p3").score, -5);
});

test("players over 100 are eliminated and the last active player wins", () => {
  const session = readySession(2);
  session.players.find((player) => player.id === "p2").score = 95;
  session.round.currentPlayerId = "p1";
  session.round.phase = "show_or_end";
  session.round.hands.p1 = [card("4", "H"), card("5", "D")];
  session.round.hands.p2 = [card("K", "C")];

  declareShow(session, "p1");

  assert.equal(session.players.find((player) => player.id === "p2").eliminated, true);
  assert.equal(session.status, "finished");
  assert.equal(session.winnerId, "p1");
});

test("disconnected players are removed after the grace window", () => {
  const session = readySession(2);
  session.round.currentPlayerId = "p2";
  session.round.phase = "discard";

  markPlayerDisconnected(session, "p2", 1);
  const removed = removeDisconnectedPlayer(session, "p2", 61_001);

  assert.equal(removed, true);
  assert.equal(session.players.find((player) => player.id === "p2").removed, true);
  assert.equal(session.status, "finished");
  assert.equal(session.winnerId, "p1");
});

function readySession(playerCount) {
  const session = createSession({ code: "ABC123", hostId: "p1", hostName: "Ada", now: 1 });

  for (let index = 2; index <= playerCount; index += 1) {
    addPlayer(session, {
      id: `p${index}`,
      name: `Player ${index}`,
      now: index
    });
  }

  for (let index = 1; index <= playerCount; index += 1) {
    setPlayerReady(session, `p${index}`, true, 10 + index);
  }

  return session;
}

function card(rank, suit) {
  return {
    id: `${rank}-${suit}`,
    rank,
    suit
  };
}
