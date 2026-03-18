/**
 * POST /api/profiler
 * 
 * Background Profiler Agent — "The Shrink"
 * Called every 60s from the frontend to analyze interviewer psychology.
 * 
 * Accepts:
 *   { currentProfileState: object|null, latestChunk: string[] }
 * 
 * Returns:
 *   { interviewers: [...], conversation_phase, room_power }
 * 
 * Non-streaming. JSON mode forced. max_tokens: 250. temperature: 0.2.
 */
import { buildProfilerPrompt, buildProfilerUserMessage } from '../../../lib/buildSystemPrompt';
import { readFileSync } from 'fs';
import { join } from 'path';

function getKnowledgeBase() {
  try {
    const kbPath = join(process.cwd(), 'lib', 'knowledge_base.json');
    return JSON.parse(readFileSync(kbPath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

export async function POST(request) {
  try {
    const { currentProfileState, latestChunk } = await request.json();

    if (!latestChunk || (Array.isArray(latestChunk) && latestChunk.length === 0)) {
      // Nothing to analyze
      return Response.json(currentProfileState || { interviewers: [], conversation_phase: 'opening', room_power: 'Neutral' });
    }

    const kb = getKnowledgeBase();
    const systemPrompt = buildProfilerPrompt(kb);
    const userMessage = buildProfilerUserMessage(currentProfileState, latestChunk);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const provider = (process.env.LLM_PROVIDER || 'cohere').toLowerCase();

    let result;
    if (provider === 'groq') {
      result = await callGroqJSON(messages);
    } else {
      result = await callCohereJSON(messages);
    }

    return Response.json(result);
  } catch (err) {
    console.error('[profiler] Error:', err);
    // On error, return previous state or empty — never crash the loop
    return Response.json(
      { interviewers: [], conversation_phase: 'unknown', room_power: 'Neutral', _error: err.message },
      { status: 200 } // Still 200 so frontend doesn't break
    );
  }
}

// ── Cohere (non-streaming, JSON-ish) ──
async function callCohereJSON(messages) {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error('COHERE_API_KEY not configured');

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.COHERE_MODEL || 'command-a-03-2025',
      messages,
      temperature: 0.2,
      max_tokens: 400,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Cohere ${res.status}: ${errText}`);
  }

  const data = await res.json();
  // Cohere v2: response in message.content[0].text
  const text = data.message?.content?.[0]?.text || '';
  return parseJSON(text);
}

// ── Groq (non-streaming, JSON mode) ──
async function callGroqJSON(messages) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.2,
      max_tokens: 250,
      response_format: { type: 'json_object' }, // Force JSON mode
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseJSON(text);
}

// ── Robust JSON parser — handles markdown-wrapped JSON ──
function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try stripping markdown code fences
    const cleaned = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      console.warn('[profiler] Failed to parse JSON:', text.slice(0, 200));
      return { interviewers: [], conversation_phase: 'unknown', room_power: 'Neutral', _raw: text.slice(0, 200) };
    }
  }
}
