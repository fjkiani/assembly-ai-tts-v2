/**
 * POST /api/generate-context
 * 
 * Takes a job description / company context and uses LLM to generate:
 *   1. Domain-specific keyterms for AssemblyAI STT boosting
 *   2. A contextual prompt for AssemblyAI turn detection
 * 
 * Input:  { context: string }  (job description, company notes, etc.)
 * Output: { keyterms: string[], prompt: string }
 */

function getSystemPrompt() {
  return `You are a technical interview preparation assistant. Given a job description or company context, extract two things:

1. **keyterms**: A flat JSON array of 20-40 domain-specific technical terms that the candidate and interviewer are likely to say during this interview. Focus on:
   - Technology stack terms (frameworks, languages, tools)
   - Company-specific product names, team names, platform names
   - Industry jargon and acronyms
   - Architecture patterns mentioned (microservices, event-driven, etc.)
   - Compliance/certification terms (SOC2, HIPAA, PCI, etc.)
   These will be injected into a speech-to-text engine to boost recognition accuracy. Only include terms that are hard to transcribe (acronyms, brand names, technical terms). Don't include common English words.

2. **prompt**: A single sentence describing the audio context for a speech-to-text model. Format: "[Role] technical interview discussing [key topics]. Speakers may pause mid-question."

OUTPUT STRICTLY IN JSON FORMAT:
{
  "keyterms": ["term1", "term2", ...],
  "prompt": "string"
}

No markdown. No prose. Just the JSON object.`;
}

export async function POST(request) {
  try {
    const { context } = await request.json();
    if (!context || !context.trim()) {
      return Response.json({ error: 'No context provided' }, { status: 400 });
    }

    const provider = (process.env.LLM_PROVIDER || 'cohere').toLowerCase();

    const messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: `Here is the job description / interview context:\n\n${context}` },
    ];

    let result;
    if (provider === 'groq') {
      result = await callGroq(messages);
    } else {
      result = await callCohere(messages);
    }

    return Response.json(result);
  } catch (err) {
    console.error('[generate-context] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function callCohere(messages) {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error('COHERE_API_KEY not configured');

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.COHERE_MODEL || 'command-a-03-2025',
      messages,
      temperature: 0.2,
      max_tokens: 500,
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Cohere ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.message?.content?.[0]?.text || '';
  return parseJSON(text);
}

async function callGroq(messages) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseJSON(text);
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      console.warn('[generate-context] Failed to parse:', text.slice(0, 200));
      return { keyterms: [], prompt: 'Technical job interview between two speakers.' };
    }
  }
}
