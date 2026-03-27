const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// CRITICAL: disable Vercel's automatic body parsing so we can read the raw body
// needed for Slack signature verification
export const config = { api: { bodyParser: false } };

// Read raw body from request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySlackSignature(rawBody, headers) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true; // skip in dev if not set
  const timestamp = headers['x-slack-request-timestamp'];
  const slackSig = headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const computed = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
  } catch {
    return false;
  }
}

async function slackReply(channelId, text) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel: channelId, text, mrkdwn: true })
  });
  const data = await res.json();
  if (!data.ok) console.error('slackReply error:', data.error);
}

function loadNameMap() {
  const nameMapPath = path.join(process.cwd(), 'name-map.json');
  return JSON.parse(fs.readFileSync(nameMapPath, 'utf8'));
}

function parseDateTime(date, timeStr) {
  const match = (timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) throw new Error(`Invalid time: "${timeStr}"`);
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

async function scheduleForPerson(name, slackUserId, date, startTime, endTime) {
  const appUrl = process.env.APP_URL;
  const now = new Date();
  const startDT = parseDateTime(date, startTime);
  const endDT = parseDateTime(date, endTime);
  const headsUpDT = new Date(startDT.getTime() - 15 * 60 * 1000);

  const jobs = [
    { time: headsUpDT, message: `🔔 *Heads-up!* You're on pit duty in 15 minutes — *${startTime}* to *${endTime}*. Start heading over!` },
    { time: startDT,   message: `🚨 *Your pit shift starts now!* Head to the pit area. _(${startTime} – ${endTime})_` },
    { time: endDT,     message: `✅ *Your pit shift is over!* Great work — you're free to go. _(${startTime} – ${endTime})_` }
  ];

  let scheduled = 0;
  for (const job of jobs) {
    if (job.time <= now) { console.log(`Skipping past job for ${name} at ${job.time}`); continue; }
    const qRes = await fetch(`https://qstash.upstash.io/v2/publish/${appUrl}/api/send-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Not-Before': Math.floor(job.time.getTime() / 1000).toString()
      },
      body: JSON.stringify({ slack_user_id: slackUserId, message: job.message })
    });
    if (!qRes.ok) {
      const err = await qRes.text();
      console.error(`QStash error for ${name}:`, err);
    } else {
      scheduled++;
    }
  }
  return scheduled;
}

async function handleImage(file, channelId, date) {
  if (!date) {
    await slackReply(channelId, '📅 Please set the competition date first!\nSend: `date 2026-04-05`');
    return;
  }

  await slackReply(channelId, '🔍 Got it! Parsing your schedule image with AI...');

  // Download the image from Slack
  const fileRes = await fetch(file.url_private, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
  });

  if (!fileRes.ok) {
    await slackReply(channelId, `❌ Couldn't download the image from Slack (${fileRes.status}). Make sure the bot has the \`files:read\` scope.`);
    return;
  }

  const arrayBuf = await fileRes.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString('base64');
  const mimeType = file.mimetype || 'image/png';

  // Ask Gemini to parse it
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: `This is a pit crew schedule grid for a robotics competition on ${date}.
Extract every name-to-timeslot assignment from this image.
Return ONLY a raw JSON array — no markdown, no code fences, no explanation, nothing else.
Each object must have exactly:
  "name": person's full name as written
  "start_time": shift start in 12-hour format like "10:00 AM"
  "end_time": shift end in 12-hour format like "10:45 AM"
Multiple names in one cell = one entry per name, same times. Skip blank cells.` }
        ]}],
        generationConfig: { temperature: 0.1 }
      })
    }
  );

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    await slackReply(channelId, `❌ Gemini API error: ${geminiRes.status}. Check your GEMINI_API_KEY in Vercel.`);
    console.error('Gemini error:', errText);
    return;
  }

  const geminiData = await geminiRes.json();
  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = rawText.replace(/```json|```/g, '').trim();

  let schedule;
  try {
    schedule = JSON.parse(cleaned);
    if (!Array.isArray(schedule)) throw new Error('Not an array');
  } catch (e) {
    await slackReply(channelId, `❌ Couldn't parse the schedule from that image.\n_Raw response:_ \`${cleaned.slice(0, 200)}\`\n\nTry a clearer/higher contrast photo.`);
    return;
  }

  if (schedule.length === 0) {
    await slackReply(channelId, `⚠️ The image was read but no schedule entries were found. Try a clearer photo.`);
    return;
  }

  let nameMap;
  try { nameMap = loadNameMap(); }
  catch (e) {
    await slackReply(channelId, `❌ Couldn't load name-map.json: ${e.message}`);
    return;
  }

  await slackReply(channelId, `📋 Found *${schedule.length} entries* in the schedule. Scheduling notifications...`);

  const scheduled = [], skipped = [];
  for (const entry of schedule) {
    const slackUserId = nameMap[entry.name];
    if (!slackUserId) { skipped.push(entry.name); continue; }
    try {
      const count = await scheduleForPerson(entry.name, slackUserId, date, entry.start_time, entry.end_time);
      scheduled.push(`${entry.name} — ${entry.start_time} to ${entry.end_time} (${count} msgs)`);
    } catch (e) {
      skipped.push(`${entry.name} — error: ${e.message}`);
    }
  }

  let reply = `✅ *Done! Schedule processed for ${date}*\n\n`;
  if (scheduled.length) reply += `*Scheduled (${scheduled.length}):*\n${scheduled.map(n => `• ${n}`).join('\n')}\n\n`;
  if (skipped.length) reply += `*⚠️ Skipped — not in name-map.json (${skipped.length}):*\n${skipped.map(n => `• ${n}`).join('\n')}\n\n_Update name-map.json in GitHub with these names to fix this._`;

  await slackReply(channelId, reply);
}

async function handleText(text, channelId, sessionDate) {
  const lower = text.trim().toLowerCase();

  if (lower === 'help' || lower === '?') {
    await slackReply(channelId,
      `*🤖 Pit Scheduler — Commands*\n\n` +
      `*1. Set competition date:*\n\`date 2026-04-05\`\n\n` +
      `*2. Upload schedule:*\nDrop a photo of the schedule here — AI reads it automatically!\n\n` +
      `*3. Manually notify one person:*\n\`notify John Smith | 2026-04-05 | 10:00 AM | 10:45 AM\`\n\n` +
      `💡 _Always set the date first, then upload the image._`
    );
    return { date: sessionDate };
  }

  // Set date: "date 2026-04-05"
  const dateMatch = text.trim().match(/^date\s+(\d{4}-\d{2}-\d{2})$/i);
  if (dateMatch) {
    const newDate = dateMatch[1];
    await slackReply(channelId, `📅 Competition date set to *${newDate}*. Now upload a schedule image or use \`notify\` to add someone manually!`);
    return { date: newDate };
  }

  // Manual notify: "notify John Smith | 2026-04-05 | 10:00 AM | 10:45 AM"
  const notifyMatch = text.trim().match(/^notify\s+(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{1,2}:\d{2}\s*[AP]M)\s*\|\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (notifyMatch) {
    const [, name, date, startTime, endTime] = notifyMatch;
    let nameMap;
    try { nameMap = loadNameMap(); } catch (e) {
      await slackReply(channelId, `❌ Couldn't load name-map.json: ${e.message}`);
      return { date: sessionDate };
    }
    const slackUserId = nameMap[name.trim()];
    if (!slackUserId) {
      await slackReply(channelId, `⚠️ *"${name.trim()}"* wasn't found in name-map.json. Check the spelling matches exactly.`);
      return { date: sessionDate };
    }
    try {
      const count = await scheduleForPerson(name.trim(), slackUserId, date, startTime.trim(), endTime.trim());
      await slackReply(channelId, `✅ Scheduled *${count} notification${count !== 1 ? 's' : ''}* for *${name.trim()}* on ${date} (${startTime.trim()} – ${endTime.trim()})`);
    } catch (e) {
      await slackReply(channelId, `❌ Error: ${e.message}`);
    }
    return { date: sessionDate };
  }

  await slackReply(channelId, `🤔 I didn't understand that. Send \`help\` to see what I can do!`);
  return { date: sessionDate };
}

const sessions = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Read raw body BEFORE parsing — needed for Slack signature verification
  const rawBody = await getRawBody(req);
  let body;
  try { body = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  // Handle Slack URL verification FIRST — no auth needed for this
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Now verify signature for all other requests
  if (!verifySlackSignature(rawBody, req.headers)) {
    console.error('Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  if (body.type !== 'event_callback') return res.status(200).end();

  const event = body.event;
  if (!event || event.type !== 'message' || event.bot_id || event.subtype === 'bot_message') {
    return res.status(200).end();
  }

  // Respond to Slack immediately — must be within 3 seconds
  res.status(200).end();

  const channelId = event.channel;
  const userId = event.user;
  const sessionKey = `${userId}:${channelId}`;
  const currentDate = sessions[sessionKey]?.date || null;

  try {
    if (event.files?.length > 0) {
      const imageFile = event.files.find(f => f.mimetype?.startsWith('image/'));
      if (imageFile) {
        await handleImage(imageFile, channelId, currentDate);
        return;
      }
    }

    if (event.text) {
      const result = await handleText(event.text, channelId, currentDate);
      if (result?.date) sessions[sessionKey] = { date: result.date };
    }
  } catch (err) {
    console.error('Unhandled error in slack-events:', err);
    try { await slackReply(channelId, `❌ Something went wrong: ${err.message}`); } catch {}
  }
}
