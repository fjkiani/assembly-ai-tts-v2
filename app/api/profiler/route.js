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

/**
 * Deep-merge LLM delta output into persistent profiler state.
 * The LLM outputs ONLY new insights. This function merges them.
 */
function deepMergeProfilerState(currentState, delta) {
  const state = currentState || {
    interviewers: [],
    alpha_telemetry: { pillars_deployed: [], pillars_missing: [], is_off_script: false, off_script_reason: null },
    conversation_phase: 'opening',
    room_power: 'Neutral',
  };

  // Merge new interviewer insights
  if (delta.new_interviewer_insights?.length > 0) {
    for (const insight of delta.new_interviewer_insights) {
      const existing = state.interviewers.find(i => i.name === insight.name);
      if (existing) {
        // Patch existing interviewer — only overwrite non-null fields
        if (insight.emotional_state) existing.emotional_state = insight.emotional_state;
        if (insight.corporate_trauma) existing.corporate_trauma = insight.corporate_trauma;
        if (insight.the_exploit) existing.the_exploit = insight.the_exploit;
      } else {
        state.interviewers.push(insight);
      }
    }
  }

  // Merge newly deployed pillars (dedupe)
  if (delta.new_pillars_deployed?.length > 0) {
    const deployed = new Set(state.alpha_telemetry.pillars_deployed || []);
    for (const p of delta.new_pillars_deployed) deployed.add(p);
    state.alpha_telemetry.pillars_deployed = [...deployed];
    // Recalculate missing pillars
    const allPillars = getKnowledgeBase()?.candidate?.campaign_pillars || [];
    state.alpha_telemetry.pillars_missing = allPillars.filter(p => !deployed.has(p));
  }

  // Update off-script status
  if (delta.new_off_script?.detected) {
    state.alpha_telemetry.is_off_script = true;
    state.alpha_telemetry.off_script_reason = delta.new_off_script.reason;
  }

  // Always update phase
  if (delta.conversation_phase) state.conversation_phase = delta.conversation_phase;

  return state;
}

export async function POST(request) {
  try {
    const { currentProfileState, latestChunk } = await request.json();

    if (!latestChunk || (Array.isArray(latestChunk) && latestChunk.length === 0)) {
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

    let delta;
    if (provider === 'groq') {
      delta = await callGroqJSON(messages);
    } else {
      delta = await callCohereJSON(messages);
    }

    // Deep-merge LLM delta into persistent state (not LLM state-patching)
    const mergedState = deepMergeProfilerState(currentProfileState, delta);
    return Response.json(mergedState);
  } catch (err) {
    console.error('[profiler] Error:', err);
    return Response.json(
      { interviewers: [], conversation_phase: 'unknown', room_power: 'Neutral', _error: err.message },
      { status: 200 }
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
