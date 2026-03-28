const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { schedule, date } = req.body;

    if (!schedule || !date) {
      return res.status(400).json({ error: 'Missing schedule or date' });
    }

    const nameMapPath = path.join(process.cwd(), 'name-map.json');
    let nameMap;
    try {
      nameMap = JSON.parse(fs.readFileSync(nameMapPath, 'utf8'));
    } catch (e) {
      return res.status(500).json({ error: 'Could not read name-map.json: ' + e.message });
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      return res.status(500).json({ error: 'APP_URL environment variable is not set' });
    }

    const scheduled = [];
    const skipped = [];
    const now = new Date();

    for (const entry of schedule) {
      const slackUserId = nameMap[entry.name];

      if (!slackUserId) {
        skipped.push(entry.name);
        continue;
      }

      let startDT, endDT;
      try {
        startDT = parseDateTime(date, entry.start_time);
        endDT = parseDateTime(date, entry.end_time);
      } catch (e) {
        skipped.push(`${entry.name} (bad time format: ${e.message})`);
        continue;
      }

      const headsUpDT = new Date(startDT.getTime() - 15 * 60 * 1000);

      const jobs = [
        {
          time: headsUpDT,
          message: `🔔 *Heads-up!* You're on pit duty in 15 minutes — *${entry.start_time}* to *${entry.end_time}*. Start heading over!`
        },
        {
          time: startDT,
          message: `🚨 *Your pit shift starts now!* Head to the pit area. _(${entry.start_time} – ${entry.end_time})_`
        },
        {
          time: endDT,
          message: `✅ *Your pit shift is over!* Great work — you're free to go. _(${entry.start_time} – ${entry.end_time})_`
        }
      ];

      for (const job of jobs) {
        if (job.time <= now) continue;

        const qstashRes = await fetch(
          `https://qstash.upstash.io/v2/publish/${appUrl}/api/send-notification`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
              'Content-Type': 'application/json',
              'Upstash-Not-Before': Math.floor(job.time.getTime() / 1000).toString()
            },
            body: JSON.stringify({
              slack_user_id: slackUserId,
              message: job.message
            })
          }
        );

        if (!qstashRes.ok) {
          const errText = await qstashRes.text();
          console.error('QStash error for', entry.name, ':', errText);
        }
      }

      scheduled.push(entry.name);
    }

    res.json({ scheduled, skipped });
  } catch (err) {
    console.error('schedule-notifications error:', err);
    res.status(500).json({ error: err.message });
  }
};

function parseDateTime(date, timeStr) {
  const trimmed = (timeStr || '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) throw new Error(`"${timeStr}" is not a valid time`);

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  const [year, month, day] = date.split('-').map(Number);
  const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return dt;
}
