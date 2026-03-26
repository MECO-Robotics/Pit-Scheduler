# 🤖 Pit Scheduler

Auto-notifies your robotics team via Slack DM based on a pit schedule image.

## How it works

1. Upload a schedule photo → Gemini AI reads the grid
2. Review & confirm the parsed names/times
3. Hit "Schedule" → every person gets 3 Slack DMs:
   - 🔔 15 minutes before their shift
   - 🚨 At the exact start of their shift
   - ✅ At the exact end of their shift

---

## Setup

### 1. Clone & open in GitHub

Push this folder to a new GitHub repo.

### 2. Deploy to Vercel

- Go to vercel.com → New Project → Import your GitHub repo
- Vercel will detect it automatically — just click Deploy

### 3. Set Environment Variables in Vercel

In your Vercel project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `SLACK_BOT_TOKEN` | Your `xoxb-` token from api.slack.com |
| `GEMINI_API_KEY` | Your key from aistudio.google.com |
| `QSTASH_TOKEN` | Your token from upstash.com/qstash |
| `APP_URL` | Your Vercel deployment URL, e.g. `https://pit-scheduler.vercel.app` |

Redeploy after adding variables.

### 4. Fill in name-map.json

Visit `https://your-app.vercel.app/api/list-users` in your browser.
It shows a table of everyone in your Slack workspace with their IDs.

Edit `name-map.json` to match names exactly as they appear on your schedule:

```json
{
  "John Smith": "U012AB3CD",
  "Jane Doe": "U098ZY7WX"
}
```

Push the updated file to GitHub — Vercel will redeploy automatically.

### 5. Use it!

Go to your Vercel URL, pick the competition date, upload the schedule image, and schedule away.

---

## File Structure

```
pit-scheduler/
├── api/
│   ├── parse-schedule.js        # Gemini vision parser
│   ├── schedule-notifications.js # QStash job scheduler
│   ├── send-notification.js     # Slack DM sender (called by QStash)
│   ├── check-name.js            # Checks if name is in name-map
│   └── list-users.js            # Lists all Slack workspace users
├── public/
│   └── index.html               # Web UI
├── name-map.json                # Name → Slack ID mapping (edit this!)
├── package.json
└── vercel.json
```
