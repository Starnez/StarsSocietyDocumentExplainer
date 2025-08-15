export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const origin = event.headers['origin'] || '';
    // Optional: restrict origins
    const allowed = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
    if (allowed.length && !allowed.includes(origin)) {
      return { statusCode: 403, body: 'Forbidden' };
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { statusCode: 500, body: 'Proxy not configured' };

    const body = JSON.parse(event.body || '{}');
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || 'https://stars-society-docs.example',
        'X-Title': 'Stars Society Document Explainer'
      },
      body: JSON.stringify(body)
    });
    const text = await resp.text();
    return { statusCode: resp.status, body: text, headers: { 'Content-Type': 'application/json' } };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
}


