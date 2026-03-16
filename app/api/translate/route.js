/**
 * POST /api/translate
 * Receives { text, languageCode } and returns a Cohere-translated string.
 * Mirrors the LLM Gateway step from the original assemblyai_service.py.
 */
export async function POST(request) {
  const cohereKey = process.env.COHERE_API_KEY || 'OIlUp71HbmDsKX1iDCCBIIwiYvDG1yTtYugPoQ1h';
  if (!cohereKey) {
    return Response.json({ error: 'COHERE_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { text, languageCode } = await request.json();

    if (!text || !text.trim()) {
      return Response.json({ error: 'No text provided' }, { status: 400 });
    }

    const lang = (languageCode || '').toLowerCase();
    const isSpanish = lang.startsWith('es');
    const isItalian = lang.startsWith('it');
    const isFrench = lang.startsWith('fr');
    const isEnglish = lang.startsWith('en');

    let targetLang, prompt;

    if (isSpanish || isItalian || isFrench) {
      targetLang = 'EN';
      prompt = `Translate the following spoken phrase directly to English. Output ONLY the raw translation, no quotes or intro: '${text}'`;
    } else if (isEnglish) {
      targetLang = 'ES';
      prompt = `Translate the following spoken phrase directly to Spanish. Output ONLY the raw translation, no quotes or intro: '${text}'`;
    } else {
      targetLang = 'EN';
      prompt = `Identify the language and translate the following phrase directly to English. Output ONLY the raw translation: '${text}'`;
    }

    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cohereKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'command-a-03-2025',
        messages: [
          {
            role: 'system',
            content: 'You are a translation assistant. Output ONLY the raw translation, nothing else. No quotes, no explanation.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[translate] Cohere error:', res.status, errText);
      // Graceful fallback — return the text as-is with a flag
      return Response.json({
        translation: `[${targetLang}] ${text}`,
        targetLang,
        fallback: true,
        error: errText,
      });
    }

    const data = await res.json();
    // v2/chat response: { message: { content: [{ text: "..." }] } }
    const translatedText = (data?.message?.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');

    return Response.json({
      translation: `[${targetLang}] ${translatedText}`,
      targetLang,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
