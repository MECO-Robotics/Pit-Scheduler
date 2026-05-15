// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// TEAM SCHEDULER - Google Apps Script
// Reads from Google Sheets, posts to Slack, DMs individuals on a timer
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// --------- CONFIGURATION ---------------------------------------------------------------------------------------------------------------------------
// 
// Copy config.gs.example to config.gs and fill in your values there.
// The config.gs file is listed in .gitignore and will not be committed.
//
// Required variables (defined in config.gs):
//   - SLACK_BOT_TOKEN
//   - SLACK_CHANNEL
//   - SHEET_ID
//   - NAME_MAP

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// STEP 1 - Select "postSchedule" in the dropdown and click Run
// Posts the schedule to Slack and DMs everyone their shift
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function postSchedule() {
  var schedule = readScheduleFromSheet();

  if (schedule.length === 0) {
    Logger.log('No entries found in the sheet. Make sure rows have Name, Type, Date, Start, End filled in.');
    return;
  }

  // Group by type and date for the channel post
  var groups = {};
  for (var i = 0; i < schedule.length; i++) {
    var entry = schedule[i];
    var key = entry.type + '|' + entry.date;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(entry);
  }

  // Post each group to the channel
  for (var key in groups) {
    var parts   = key.split('|');
    var type    = parts[0];
    var date    = parts[1];
    var entries = groups[key];
    postScheduleToChannel(entries, type, date);
  }

  // DM each person their own shift
  var dmsSent = 0;
  var dmsSkipped = [];
  for (var i = 0; i < schedule.length; i++) {
    var entry = schedule[i];
    if (sendAssignmentDM(entry.name, entry.type, entry.date, entry.start, entry.end)) {
      dmsSent++;
    } else {
      dmsSkipped.push(entry.name);
    }
  }

  Logger.log('Schedule posted. DMs sent: ' + dmsSent + '. Skipped: ' + dmsSkipped.join(', '));
  if (dmsSkipped.length > 0) {
    Logger.log('Add these names to NAME_MAP: ' + dmsSkipped.join(', '));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// STEP 2 - Select "installTrigger" in the dropdown and click Run ONCE
// Sets up the every-minute check for shift notifications
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkAndNotify') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('checkAndNotify')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('Trigger installed. checkAndNotify will run every minute.');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// INTERNAL - runs every minute via the trigger
// Sends 15min warning, start, and end notifications at the right time
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function checkAndNotify() {
  var schedule = readScheduleFromSheet();
  var now = new Date();

  for (var i = 0; i < schedule.length; i++) {
    var entry  = schedule[i];
    var userId = NAME_MAP[entry.name];
    if (!userId) {
      continue;
    }

    var startDT   = parseDateTime(entry.date, entry.start);
    var endDT     = parseDateTime(entry.date, entry.end);
    var headsUpDT = new Date(startDT.getTime() - 15 * 60 * 1000);

    var nowMs     = now.getTime();
    var startMs   = startDT.getTime();
    var endMs     = endDT.getTime();
    var headsUpMs = headsUpDT.getTime();

    var typeLabel = entry.type === 'scouting' ? 'scouting' : 'pit crew';
    var sentFlags = entry.sent || {};

    // Heads-up: within 90 seconds of T-15
    if (!sentFlags.headsup && Math.abs(nowMs - headsUpMs) < 90 * 1000) {
      sendSlackDM(userId,
        'Heads-up! You are on ' + typeLabel + ' duty in 15 minutes - ' + entry.start + ' to ' + entry.end + '. Start heading over!'
      );
      markSent(entry.row, 'headsup');
      Logger.log('Sent heads-up to ' + entry.name);
    }

    // Shift start: within 90 seconds of start time
    if (!sentFlags.start && Math.abs(nowMs - startMs) < 90 * 1000) {
      sendSlackDM(userId,
        'Your ' + typeLabel + ' shift starts now! Head over. (' + entry.start + ' to ' + entry.end + ')'
      );
      markSent(entry.row, 'start');
      Logger.log('Sent start to ' + entry.name);
    }

    // Shift end: within 90 seconds of end time
    if (!sentFlags.end && Math.abs(nowMs - endMs) < 90 * 1000) {
      sendSlackDM(userId,
        'Your ' + typeLabel + ' shift is over! Great work - you are free. (' + entry.start + ' to ' + entry.end + ')'
      );
      markSent(entry.row, 'end');
      Logger.log('Sent end to ' + entry.name);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function readScheduleFromSheet() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var data  = sheet.getDataRange().getValues();

  var schedule = [];
  for (var i = 1; i < data.length; i++) {
    var row   = data[i];
    var name  = (row[0] || '').toString().trim();
    var type  = (row[1] || 'pit').toString().trim().toLowerCase();
    var date  = formatDate(row[2]);
    var start = formatTime(row[3]);
    var end   = formatTime(row[4]);

    if (!name || !date || !start || !end) {
      continue;
    }

    schedule.push({
      row:   i + 1,
      name:  name,
      type:  type,
      date:  date,
      start: start,
      end:   end,
      sent: {
        headsup: !!(row[5] || '').toString().trim(),
        start:   !!(row[6] || '').toString().trim(),
        end:     !!(row[7] || '').toString().trim()
      }
    });
  }
  return schedule;
}

function markSent(rowIndex, type) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var col = 6;
  if (type === 'start') {
    col = 7;
  } else if (type === 'end') {
    col = 8;
  }
  sheet.getRange(rowIndex, col).setValue('sent');
}

function postScheduleToChannel(entries, type, date) {
  var typeLabel = type === 'scouting' ? 'Scouting' : 'Pit Crew';
  var dateObj   = new Date(date + 'T12:00:00');
  var dateFmt   = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Group by time slot
  var slots = {};
  for (var i = 0; i < entries.length; i++) {
    var key = entries[i].start + ' - ' + entries[i].end;
    if (!slots[key]) {
      slots[key] = [];
    }
    slots[key].push(entries[i].name);
  }

  var scheduleText = '';
  for (var slot in slots) {
    scheduleText += '*' + slot + '*\n';
    var names = slots[slot];
    for (var j = 0; j < names.length; j++) {
      var userId = NAME_MAP[names[j]];
      scheduleText += '  - ' + (userId ? '<@' + userId + '>' : names[j]) + '\n';
    }
    scheduleText += '\n';
  }

  var payload = {
    channel: SLACK_CHANNEL,
    text: typeLabel + ' Schedule - ' + dateFmt,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: typeLabel + ' Schedule', emoji: false }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*' + dateFmt + '*' }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: scheduleText.trim() }
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: 'Everyone will receive Slack DM reminders for their shifts.' }]
      }
    ]
  };

  var res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (!data.ok) {
    Logger.log('chat.postMessage error: ' + data.error);
  }
}

function sendSlackDM(slackUserId, message) {
  var openRes = UrlFetchApp.fetch('https://slack.com/api/conversations.open', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN },
    contentType: 'application/json',
    payload: JSON.stringify({ users: slackUserId }),
    muteHttpExceptions: true
  });
  var openData = JSON.parse(openRes.getContentText());
  if (!openData.ok) {
    Logger.log('conversations.open error: ' + openData.error);
    return;
  }

  var msgRes = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN },
    contentType: 'application/json',
    payload: JSON.stringify({ channel: openData.channel.id, text: message, mrkdwn: true }),
    muteHttpExceptions: true
  });
  var msgData = JSON.parse(msgRes.getContentText());
  if (!msgData.ok) {
    Logger.log('chat.postMessage error: ' + msgData.error);
  }
}

/** Same DM text as postSchedule; returns true if a DM was sent. */
function sendAssignmentDM(name, type, date, start, end) {
  var n = (name || '').toString().trim();
  if (!n || !date || !start || !end) {
    return false;
  }
  var t = (type || 'pit').toString().trim().toLowerCase();
  var userId = NAME_MAP[n];
  if (!userId) {
    Logger.log('sendAssignmentDM: no NAME_MAP entry for "' + n + '"');
    return false;
  }
  var typeLabel = t === 'scouting' ? 'Scouting' : 'Pit Crew';
  sendSlackDM(userId,
    '*You have been scheduled for ' + typeLabel + ' duty!*\n' +
    '*Date:* ' + date + '\n' +
    '*Time:* ' + start + ' to ' + end + '\n\n' +
    '_You will get a reminder 15 min before, at the start, and when your shift ends._'
  );
  return true;
}

function parseDateTime(date, timeStr) {
  var match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    throw new Error('Invalid time: ' + timeStr);
  }
  var hours   = parseInt(match[1], 10);
  var minutes = parseInt(match[2], 10);
  var period  = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  }
  if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  var parts = date.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, 0, 0);
}

function formatDate(val) {
  if (!val) {
    return '';
  }
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = ('0' + (val.getMonth() + 1)).slice(-2);
    var d = ('0' + val.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return val.toString().trim();
}

function formatTime(val) {
  if (!val) {
    return '';
  }
  if (val instanceof Date) {
    var hours   = val.getHours();
    var minutes = ('0' + val.getMinutes()).slice(-2);
    var period  = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return hours + ':' + minutes + ' ' + period;
  }
  return val.toString().trim();
}

// -----------------------------------------------------------------------
// WEB APP - serves the frontend UI
// -----------------------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Team Scheduler')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSchedule() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var rows  = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!(row[0] || '').toString().trim()) continue;
    rows.push({
      row:        i + 1,
      name:       (row[0] || '').toString().trim(),
      type:       (row[1] || 'pit').toString().trim().toLowerCase(),
      date:       formatDate(row[2]),
      start:      formatTime(row[3]),
      end:        formatTime(row[4]),
      sentHeadsup: !!(row[5] || '').toString().trim(),
      sentStart:   !!(row[6] || '').toString().trim(),
      sentEnd:     !!(row[7] || '').toString().trim()
    });
  }
  return rows;
}

function addRow(name, type, date, start, end) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.appendRow([name, type, date, start, end, '', '', '']);
  sendAssignmentDM(name, type, date, start, end);
  return { ok: true };
}

function updateRow(rowIndex, name, type, date, start, end) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.getRange(rowIndex, 1, 1, 5).setValues([[name, type, date, start, end]]);
  return { ok: true };
}

function deleteRow(rowIndex) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function resendRow(rowIndex) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var row   = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
  var name  = (row[0] || '').toString().trim();
  var type  = (row[1] || 'pit').toString().trim().toLowerCase();
  var date  = formatDate(row[2]);
  var start = formatTime(row[3]);
  var end   = formatTime(row[4]);
  var userId = NAME_MAP[name];
  if (!userId) return { ok: false, error: 'Name not in NAME_MAP' };
  var typeLabel = type === 'scouting' ? 'Scouting' : 'Pit Crew';
  sendSlackDM(userId,
    '*RESENT: You are scheduled for ' + typeLabel + ' duty*\n' +
    '*Date:* ' + date + '\n' +
    '*Time:* ' + start + ' to ' + end
  );
  sheet.getRange(rowIndex, 6, 1, 3).setValues([['', '', '']]);
  return { ok: true };
}

function clearAllSentFlags() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    sheet.getRange(i + 1, 6, 1, 3).setValues([['', '', '']]);
  }
  return { ok: true };
}

function bulkAddRows(rows) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.name || !r.date || !r.start || !r.end) continue;
    sheet.appendRow([r.name, r.type || 'pit', r.date, r.start, r.end, '', '', '']);
    sendAssignmentDM(r.name, r.type || 'pit', r.date, r.start, r.end);
    count++;
  }
  return count;
}

function runInstallTrigger() {
  installTrigger();
  return { ok: true };
}

function runPostSchedule() {
  postSchedule();
  return { ok: true };
}

function getNameList() {
  return Object.keys(NAME_MAP).sort();
}