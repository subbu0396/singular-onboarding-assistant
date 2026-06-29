const EMBED_TIMEOUT_MS = 5000;

export async function embedText(text) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY not configured');
  }

  let response;
  try {
    response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: [text.slice(0, 8000)],
        model: 'voyage-3-lite',
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Voyage embed timed out after ${EMBED_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `Voyage API error ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}
