# Pit Scheduler

Google Apps Script + Google Sheets scheduler for robotics teams.  
It posts shift schedules to Slack and sends each person DM reminders:

- 15 minutes before shift start
- At shift start
- At shift end

## Features

- Slack channel post grouped by role (`pit` or `scouting`) and date
- Individual Slack DMs for each scheduled person
- Automated reminder engine running every minute via Apps Script trigger
- Web UI for:
  - add/edit/delete shifts
  - bulk CSV import
  - resend notifications per row
  - reset notification flags
  - live "On Duty Right Now" and "Next Up" panels
  - printable schedule view

## Architecture

This repository is currently a **Google Apps Script** project, not a Vercel/Node API app.

- `code.gs`
  - backend logic
  - Google Sheets read/write
  - Slack API calls
  - trigger installation and notification checks
  - web app endpoint (`doGet`)
- `index.html`
  - frontend UI served by Apps Script
  - calls server functions through `google.script.run`

## Prerequisites

- Google account with access to Apps Script + Google Sheets
- A Slack app bot token (`xoxb-...`) with permission to:
  - open conversations
  - post messages
- A Google Sheet to store schedule rows

## Sheet Format

The first sheet is used with these columns:

1. Name
2. Type (`pit` or `scouting`)
3. Date (`YYYY-MM-DD`)
4. Start (for example `10:00 AM`)
5. End (for example `10:45 AM`)
6. Heads-up sent flag
7. Start sent flag
8. End sent flag

Rows missing `Name`, `Date`, `Start`, or `End` are skipped by the scheduler.

## Setup

### 1) Create an Apps Script project

Create a new project in [Apps Script](https://script.google.com/) and add:

- `code.gs` (copy from this repo)
- an HTML file for the UI (see note in step 4)

### 2) Configure constants in `code.gs`

Set these values at the top of `code.gs`:

- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL`
- `SHEET_ID`
- `NAME_MAP` (name -> Slack user ID)

`NAME_MAP` keys should match names exactly as they appear in the schedule sheet.

### 3) Add the frontend file

Copy this repo's `index.html` content into the Apps Script HTML file.

### 4) Ensure HTML filename matches `doGet`

`doGet()` currently serves:

```js
HtmlService.createHtmlOutputFromFile('Index')
```

So your Apps Script HTML file should be named `Index` (capital I), or update `doGet()` to match your chosen file name.

### 5) Authorize and initialize

In Apps Script editor:

1. Run `postSchedule` once (prompts authorization)
2. Run `installTrigger` once (creates minute-based trigger for `checkAndNotify`)

## Deploy the Web App

In Apps Script:

1. `Deploy` -> `New deployment`
2. Select type `Web app`
3. Set access according to your team needs
4. Deploy and open the web app URL

## Using the App

From the UI:

- Add shifts manually in **Add Shift**
- Paste rows in **Bulk Import CSV** using:
  - `Name,Type,Date,Start,End`
- Filter by date/type, print schedules, and manage entries
- Use:
  - **Post to Slack** -> calls `runPostSchedule()` / `postSchedule()`
  - **Activate** -> calls `runInstallTrigger()` / `installTrigger()`
  - **Reset Notif Flags** -> clears sent flags for all rows

## Server Function Reference

- `postSchedule()`: reads sheet, posts grouped schedule to channel, sends initial DMs
- `installTrigger()`: creates (and replaces existing) `checkAndNotify` minute trigger
- `checkAndNotify()`: sends heads-up/start/end DMs when within timing window
- `getSchedule()`: returns rows for UI
- `addRow()`, `updateRow()`, `deleteRow()`: schedule CRUD
- `resendRow()`: resends DM for one row and clears sent flags for that row
- `clearAllSentFlags()`: clears columns 6-8 on all data rows
- `bulkAddRows()`: appends multiple rows from UI import
- `getNameList()`: returns sorted keys from `NAME_MAP`

## Troubleshooting

- **No DMs are sent**: verify `SLACK_BOT_TOKEN` scopes and `NAME_MAP` IDs.
- **Some users are skipped**: missing/mismatched `NAME_MAP` entry for that exact name.
- **"Invalid time" errors**: use `h:mm AM/PM` format consistently.
- **Trigger not running**: rerun `installTrigger` and check project triggers in Apps Script.
- **UI doesn't load**: verify HTML filename matches `doGet()` (`Index` vs `index`).

## Security Notes

- Do not commit real Slack tokens to version control.
- `NAME_MAP` contains personal identifiers (names and Slack user IDs); treat it as sensitive.
- Consider moving secrets to Apps Script Properties Service instead of hardcoding.

## Future Improvements

- Move secrets to `PropertiesService` and remove token literals from source
- Add strict validation for date/time/type on both frontend and backend
- Replace `prompt()` edit flow with modal form validation
- Add audit logs/metrics for notification success and failures
