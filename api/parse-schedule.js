module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { imageBase64, mimeType, date } = req.body;

    if (!imageBase64 || !date) {
      return res.status(400).json({ error: 'Missing imageBase64 or date' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set in Vercel environment variables' });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } },
              { text: `This is a pit crew schedule grid for a robotics competition on ${date}. Extract every name-to-timeslot assignment. Return ONLY a raw JSON array — no markdown, no code fences, no explanation. Each object must have: "name" (exact as written), "start_time" (12-hour like "10:00 AM"), "end_time" (12-hour like "10:45 AM"). Multiple names in one cell = one entry per name with same times. Skip blank cells.` }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );

    // Check if Gemini returned an HTTP error
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini HTTP error:', geminiRes.status, errText);
      return res.status(500).json({ error: `Gemini API returned ${geminiRes.status}: ${errText.slice(0, 200)}` });
    }

    const geminiData = await geminiRes.json();

    if (!geminiData.candidates || !geminiData.candidates[0]) {
      return res.status(500).json({ error: 'Gemini returned no candidates', details: JSON.stringify(geminiData).slice(0, 300) });
    }

    const rawText = geminiData.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let schedule;
    try {
      schedule = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(500).json({ error: `Could not parse Gemini response as JSON. Got: ${cleaned.slice(0, 200)}` });
    }

    if (!Array.isArray(schedule)) {
      return res.status(500).json({ error: `Gemini response was not an array. Got: ${cleaned.slice(0, 200)}` });
    }

    res.json({ schedule });
  } catch (err) {
    console.error('parse-schedule error:', err);
    res.status(500).json({ error: err.message });
  }
};