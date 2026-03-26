// Helper endpoint — visit /api/list-users in your browser to see all
// workspace members and their Slack IDs. Use this to fill in name-map.json.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const response = await fetch('https://slack.com/api/users.list', {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
      }
    });

    const data = await response.json();
    if (!data.ok) {
      return res.status(500).json({ error: data.error });
    }

    const users = data.members
      .filter(u => !u.is_bot && !u.deleted && u.id !== 'USLACKBOT')
      .map(u => ({
        slack_id: u.id,
        real_name: u.real_name || '',
        display_name: u.profile?.display_name || ''
      }))
      .sort((a, b) => a.real_name.localeCompare(b.real_name));

    // Return as a pretty HTML table so it's easy to read in the browser
    const rows = users.map(u =>
      `<tr>
        <td>${u.real_name}</td>
        <td>${u.display_name}</td>
        <td><code>${u.slack_id}</code></td>
      </tr>`
    ).join('');

    res.setHeader('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Slack Users</title>
        <style>
          body { font-family: sans-serif; padding: 32px; background: #0d0d1a; color: #e2e8f0; }
          h1 { margin-bottom: 8px; }
          p { color: #94a3b8; margin-bottom: 24px; font-size: 0.9rem; }
          table { border-collapse: collapse; width: 100%; }
          th { text-align: left; padding: 10px 16px; background: #1a1a2e; color: #7c3aed; border-bottom: 1px solid #2d2d50; }
          td { padding: 10px 16px; border-bottom: 1px solid #1e1e38; }
          code { background: #1a1a2e; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; color: #60a5fa; }
        </style>
      </head>
      <body>
        <h1>👥 Slack Workspace Members</h1>
        <p>Copy the Slack ID next to each person into your <code>name-map.json</code> file.</p>
        <table>
          <thead><tr><th>Real Name</th><th>Display Name</th><th>Slack ID</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('list-users error:', err);
    res.status(500).json({ error: err.message });
  }
};
