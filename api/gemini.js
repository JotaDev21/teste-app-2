export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // API key: use Vercel env var, fallback to hardcoded
  const API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyASBbydBEUM9XEUsg0O70uyPWN30UMG5RI';
  const MODEL = 'gemini-1.5-flash';

  try {
    const { prompt, maxTokens = 300 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.85 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', response.status, JSON.stringify(data));
      return res.status(response.status).json({
        error: data?.error?.message || `Gemini API HTTP ${response.status}`,
        details: data
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    return res.status(200).json({ text });
  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: err.message });
  }
}
