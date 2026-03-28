const fs = require('fs');
const path = require('path');

function nameFromReq(req) {
  if (req.query && req.query.name) return req.query.name;
  const raw = req.url || '';
  const i = raw.indexOf('?');
  if (i === -1) return '';
  return new URLSearchParams(raw.slice(i)).get('name') || '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const name = nameFromReq(req);
  if (!name) {
    return res.status(400).json({ error: 'Missing name query parameter', found: false });
  }

  try {
    const nameMapPath = path.join(process.cwd(), 'name-map.json');
    const nameMap = JSON.parse(fs.readFileSync(nameMapPath, 'utf8'));
    const found = Object.prototype.hasOwnProperty.call(nameMap, name);
    res.json({ found });
  } catch (e) {
    console.error('check-name error:', e);
    res.status(500).json({ error: e.message, found: false });
  }
};
