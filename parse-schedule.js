module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { imageBase64, mimeType, date } = req.body;

    if (!imageBase64 || !date) {
      return res.status(400).json({ error: 'Missing imageBase64 or date' });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType || 'image/png',
                  data: imageBase64
                }
              },
              {
                text: `This is a pit crew schedule grid for a robotics competition on ${date}.
Extract every name-to-timeslot assignment from this schedule image.
Return ONLY a valid JSON array. No markdown. No explanation. No code fences. Just the raw JSON array.
Each item must have exactly these fields:
  "name"       - the person's full name exactly as written
  "start_time" - shift start in 12-hour format, e.g. "10:00 AM"
  "end_time"   - shift end in 12-hour format, e.g. "10:45 AM"
If multiple names share one cell, create a separate entry for each name with the same time slot.
If any cell is blank, skip it.`
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1
          }
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiData.candidates || !geminiData.candidates[0]) {
      return res.status(500).json({ error: 'Gemini returned no candidates', details: geminiData });
    }

    const rawText = geminiData.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let schedule;
    try {
      schedule = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Could not parse Gemini response as JSON', raw: rawText });
    }

    if (!Array.isArray(schedule)) {
      return res.status(500).json({ error: 'Gemini response was not an array', raw: rawText });
    }

    res.json({ schedule });
  } catch (err) {
    console.error('parse-schedule error:', err);
    res.status(500).json({ error: err.message });
  }
};
