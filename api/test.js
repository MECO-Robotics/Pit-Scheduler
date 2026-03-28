module.exports = async function handler(req, res) {
  const results = {};

  // Check env vars exist
  results.GEMINI_API_KEY = process.env.GEMINI_API_KEY ? '✅ Set (' + process.env.GEMINI_API_KEY.slice(0, 6) + '...)' : '❌ NOT SET';
  results.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ? '✅ Set' : '❌ NOT SET';
  results.QSTASH_TOKEN = process.env.QSTASH_TOKEN ? '✅ Set' : '❌ NOT SET';
  results.APP_URL = process.env.APP_URL || '❌ NOT SET';

  // Try a simple Gemini text call (no image)
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say "Gemini is working!" and nothing else.' }] }]
        })
      }
    );
    const text = await geminiRes.text();
    results.GEMINI_TEST = geminiRes.ok ? '✅ ' + text.slice(0, 100) : '❌ HTTP ' + geminiRes.status + ': ' + text.slice(0, 200);
  } catch (e) {
    results.GEMINI_TEST = '❌ ' + e.message;
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Pit Scheduler — Test</title>
    <style>
      body { font-family: sans-serif; padding: 32px; background: #0d0d1a; color: #e2e8f0; }
      h1 { margin-bottom: 24px; }
      .item { padding: 12px 16px; background: #1a1a2e; border-radius: 8px; margin-bottom: 12px; font-size: 0.95rem; }
      .label { color: #7c3aed; font-weight: bold; margin-bottom: 4px; }
    </style>
    </head>
    <body>
      <h1>🔧 Environment & Gemini Test</h1>
      ${Object.entries(results).map(([k, v]) => `
        <div class="item">
          <div class="label">${k}</div>
          <div>${v}</div>
        </div>
      `).join('')}
    </body>
    </html>
  `);
};