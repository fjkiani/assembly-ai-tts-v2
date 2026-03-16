/**
 * POST /api/token
 * Generates a temporary AssemblyAI auth token for browser-side WebSocket.
 * The real API key stays server-side — the browser only sees a short-lived token.
 */
export async function POST() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
  }

  try {
    const res = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=300', {
      method: 'GET',
      headers: {
        'Authorization': apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Token request failed: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    return Response.json({ token: data.token });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
