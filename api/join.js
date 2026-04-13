const pusher = require('./lib/pusher');
const { getRoom, createRoom, publicState, joinRoom } = require('./lib/game');

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { playerId, playerName, roomCode: existingCode, create } = req.body;
  if (!playerId || !playerName) return res.status(400).json({ err: 'playerId und playerName benötigt.' });

  let code = existingCode?.toUpperCase();
  let room;

  if (create) {
    // create new room
    code = genCode();
    room = createRoom(code, playerId, playerName);
  } else {
    // join existing
    if (!code || code.length !== 4) return res.status(400).json({ err: 'Ungültiger Raumcode.' });
    room = getRoom(code);
    if (!room) return res.status(404).json({ err: 'Raum nicht gefunden.' });
    const result = joinRoom(room, playerId, playerName);
    if (!result.ok) return res.status(400).json({ err: result.err });
  }

  // broadcast updated lobby state
  await pusher.trigger(`room-${code}`, 'state', publicState(room));

  return res.json({ ok: true, roomCode: code, state: publicState(room) });
};
