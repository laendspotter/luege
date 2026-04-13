// In-memory store — works fine for Vercel serverless (room state fits in one function instance
// since pusher triggers keep the same instance warm per room in practice).
// For production scale: swap this with Vercel KV (one line change).

const rooms = global._luegeRooms ?? (global._luegeRooms = new Map());

// ─── DECK ────────────────────────────────────────────────────────────────────

function makeDeck() {
  const deck = [];
  for (let v = 1; v <= 10; v++)
    for (let s = 0; s < 4; s++)
      deck.push({ id: `${v}-${s}`, value: v, isJoker: false });
  for (let j = 0; j < 10; j++)
    deck.push({ id: `joker-${j}`, value: 0, isJoker: true });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(playerIds) {
  const deck = shuffle(makeDeck());
  const hands = {};
  playerIds.forEach((id, i) => {
    hands[id] = deck.slice(i * 10, (i + 1) * 10);
  });
  return hands;
}

function nextPlayer(players, currentId) {
  const idx = players.findIndex(p => p.id === currentId);
  return players[(idx + 1) % players.length].id;
}

// ─── ROOM HELPERS ────────────────────────────────────────────────────────────

function getRoom(code) {
  return rooms.get(code) ?? null;
}

function createRoom(code, hostId, hostName) {
  const room = {
    code,
    phase: 'lobby',
    players: [{ id: hostId, name: hostName, isHost: true, cardCount: 0 }],
    hands: {},
    discardPile: [],
    currentTurn: null,
    pile: 0,
    lastClaim: null,
    lastAction: null,
    winner: null,
  };
  rooms.set(code, room);
  return room;
}

function publicState(room) {
  return {
    phase: room.phase,
    players: room.players,
    currentTurn: room.currentTurn,
    pile: room.pile,
    lastClaim: room.lastClaim,
    lastAction: room.lastAction,
    winner: room.winner,
  };
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────

function joinRoom(room, playerId, playerName) {
  if (room.players.find(p => p.id === playerId)) return { ok: true }; // already in
  if (room.players.length >= 10) return { ok: false, err: 'Raum voll (max. 10 Spieler).' };
  room.players.push({ id: playerId, name: playerName, isHost: false, cardCount: 0 });
  return { ok: true };
}

function startGame(room, callerId) {
  const caller = room.players.find(p => p.id === callerId);
  if (!caller?.isHost) return { ok: false, err: 'Nur der Host kann starten.' };
  if (room.players.length < 2) return { ok: false, err: 'Mindestens 2 Spieler nötig.' };

  room.hands = dealCards(room.players.map(p => p.id));
  room.discardPile = [];
  room.phase = 'playing';
  room.currentTurn = room.players[0].id;
  room.pile = 0;
  room.lastClaim = null;
  room.winner = null;
  room.lastAction = `Spiel gestartet! ${room.players[0].name} ist dran.`;
  room.players.forEach(p => { p.cardCount = 10; });
  return { ok: true };
}

function playCards(room, playerId, cardIds, claimValue, claimCount) {
  if (room.currentTurn !== playerId) return { ok: false, err: 'Du bist nicht dran.' };
  if (room.winner) return { ok: false, err: 'Spiel bereits beendet.' };

  const hand = room.hands[playerId] ?? [];
  const played = hand.filter(c => cardIds.includes(c.id));
  if (!played.length || played.length !== cardIds.length) return { ok: false, err: 'Ungültige Karten.' };

  room.hands[playerId] = hand.filter(c => !cardIds.includes(c.id));
  room.discardPile.push(...played);

  const player = room.players.find(p => p.id === playerId);
  player.cardCount = room.hands[playerId].length;

  const valLabel = claimValue === 0 ? 'Joker' : claimValue;
  room.lastClaim = { playerId, count: claimCount, value: claimValue };
  room.pile = room.discardPile.length;
  room.lastAction = `${player.name} legt ${claimCount}× ${valLabel}`;

  if (room.hands[playerId].length === 0) {
    room.winner = playerId;
    room.lastAction = `🏆 ${player.name} hat gewonnen!`;
  } else {
    room.currentTurn = nextPlayer(room.players, playerId);
  }

  return { ok: true };
}

function callLuge(room, callerId) {
  if (!room.lastClaim) return { ok: false, err: 'Niemand hat etwas gelegt.' };
  if (room.lastClaim.playerId === callerId) return { ok: false, err: 'Du kannst dich nicht selbst anzeigen.' };
  if (room.winner) return { ok: false, err: 'Spiel bereits beendet.' };

  const claim = room.lastClaim;
  const topCards = room.discardPile.slice(-claim.count);
  const wasLying = topCards.some(c => !c.isJoker && c.value !== claim.value);

  const callerName = room.players.find(p => p.id === callerId)?.name ?? '?';
  const liarName = room.players.find(p => p.id === claim.playerId)?.name ?? '?';

  const loser = wasLying ? claim.playerId : callerId;
  room.hands[loser] = [...(room.hands[loser] ?? []), ...room.discardPile];
  room.discardPile = [];

  room.players.forEach(p => { p.cardCount = (room.hands[p.id] ?? []).length; });
  room.pile = 0;
  room.lastClaim = null;
  room.currentTurn = loser;

  if (wasLying) {
    room.lastAction = `✅ ${callerName} hatte recht! ${liarName} nimmt die Karten.`;
  } else {
    room.lastAction = `❌ ${callerName} lag falsch! Nimmt die Karten.`;
  }

  return { ok: true };
}

module.exports = { getRoom, createRoom, publicState, joinRoom, startGame, playCards, callLuge };
