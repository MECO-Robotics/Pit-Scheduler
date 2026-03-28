module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { slack_user_id, message } = req.body || {};

    if (!slack_user_id || !message) {
      return res.status(400).json({ error: 'Missing slack_user_id or message' });
    }

    if (!process.env.SLACK_BOT_TOKEN) {
      return res.status(500).json({ error: 'SLACK_BOT_TOKEN is not set' });
    }

    const openRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({ users: slack_user_id })
    });

    const openData = await openRes.json();
    if (!openData.ok) {
      console.error('conversations.open error:', openData.error);
      return res.status(500).json({ error: openData.error || 'conversations.open failed' });
    }

    const channel = openData.channel && openData.channel.id;
    if (!channel) {
      return res.status(500).json({ error: 'No DM channel id from Slack' });
    }

    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        channel,
        text: message,
        mrkdwn: true
      })
    });

    const msgData = await msgRes.json();
    if (!msgData.ok) {
      console.error('chat.postMessage error:', msgData.error);
      return res.status(500).json({ error: msgData.error || 'chat.postMessage failed' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('send-notification error:', err);
    res.status(500).json({ error: err.message });
  }
};
