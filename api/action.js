const pusher = require('./lib/pusher');
const { getRoom, publicState, startGame, playCards, callLuge } = require('./lib/game');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { action, roomCode, playerId, cardIds, claimValue, claimCount } = req.body;
  if (!roomCode || !playerId || !action) return res.status(400).json({ err: 'Fehlende Parameter.' });

  const room = getRoom(roomCode.toUpperCase());
  if (!room) return res.status(404).json({ err: 'Raum nicht gefunden.' });

  let result;

  switch (action) {
    case 'start_game':
      result = startGame(room, playerId);
      break;
    case 'play_cards':
      result = playCards(room, playerId, cardIds, claimValue, claimCount);
      break;
    case 'call_luge':
      result = callLuge(room, playerId);
      break;
    default:
      return res.status(400).json({ err: 'Unbekannte Aktion.' });
  }

  if (!result.ok) return res.status(400).json({ err: result.err });

  // broadcast new public state to all players in the room
  await pusher.trigger(`room-${roomCode}`, 'state', publicState(room));

  // send private hand update to each player
  if (action === 'start_game' || action === 'play_cards' || action === 'call_luge') {
    const handTriggers = room.players.map(p =>
      pusher.trigger(`private-hand-${roomCode}-${p.id}`, 'hand', {
        cards: room.hands[p.id] ?? [],
      })
    );
    await Promise.all(handTriggers);
  }

  return res.json({ ok: true });
};
