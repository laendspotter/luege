const pusher = require('./lib/pusher');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { socket_id, channel_name, playerId } = req.body;
  if (!socket_id || !channel_name || !playerId) return res.status(400).end();

  // only allow auth if the channel name contains the player's own id
  if (!channel_name.includes(playerId)) return res.status(403).end();

  const auth = pusher.authorizeChannel(socket_id, channel_name);
  return res.json(auth);
};
