/**
 * POST /api/copilot
 * 
 * Streams LLM response via SSE (Server-Sent Events).
 * Each token arrives as a `data:` line. Client reads with ReadableStream.
 * 
 * Supports Cohere (stream: true) and Groq (stream: true).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTacticalPrompt, buildTerminalModePrompt, buildUserMessage } from '../../../lib/buildSystemPrompt';

function getKnowledgeBase() {
  try {
    const kbPath = join(process.cwd(), 'lib', 'knowledge_base.json');
    return JSON.parse(readFileSync(kbPath, 'utf-8'));
  } catch (e) {
    console.warn('[copilot] knowledge_base.json not found, using empty KB');
    return { session: { max_bullets: 3 } };
  }
}

export async function POST(request) {
  try {
    const { text, speaker, history, profilerState, clipboardCode, terminalMode, clientTelemetry } = await request.json();
    if (!text || !text.trim()) {
      return Response.json({ error: 'No text provided' }, { status: 400 });
    }

    const kb = getKnowledgeBase();

    // ── Terminal Mode: Manual UI toggle is absolute override ──
    // Fallback: auto-detect via profiler phase (fuzzy match)
    const profilerPhase = (profilerState?.conversation_phase || '').toLowerCase();
    const profilerSaysCoding = ['coding', 'code', 'live_coding', 'live coding',
      'pair_programming', 'pair programming', 'algorithm', 'implementation',
      'whiteboard', 'debugging'].some(p => profilerPhase.includes(p));
    const isCodingPhase = terminalMode || profilerSaysCoding;

    const systemPrompt = isCodingPhase
      ? buildTerminalModePrompt(kb)
      : buildTacticalPrompt(kb, profilerState || null, clientTelemetry || {}, speaker || 'interviewer');

    const maxTokens = isCodingPhase ? 2048 : 1000;
    if (isCodingPhase) {
      console.log(`[route] TERMINAL MODE ACTIVE (manual=${!!terminalMode}, profiler=${profilerSaysCoding})`);
    }

    // Build multi-turn messages
    const messages = [{ role: 'system', content: systemPrompt }];

    if (history && Array.isArray(history)) {
      for (const turn of history) {
        messages.push({ role: 'user', content: turn.question });
        // Send rawResponse if available, otherwise join bullets
        const response = turn.rawResponse || (turn.response && turn.response.join('\n')) || '';
        if (response) {
          messages.push({ role: 'assistant', content: response });
        }
      }
    }

    messages.push({ role: 'user', content: buildUserMessage(text, '', clipboardCode || '', speaker || 'interviewer') });

    const provider = (process.env.LLM_PROVIDER || 'cohere').toLowerCase();

    // ── Stream from LLM ──
    let llmStream;
    if (provider === 'groq') {
      llmStream = await streamGroq(messages, maxTokens);
    } else {
      llmStream = await streamCohere(messages, maxTokens);
    }

    // ── Pipe LLM stream as SSE to client ──
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of llmStream) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[copilot] Error:', err);
    return Response.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

// ── Cohere Streaming ──
async function* streamCohere(messages, maxTokens = 1000) {
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
      temperature: 0.3,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Cohere ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;
      
      try {
        const event = JSON.parse(jsonStr);
        // Cohere v2 streaming: content-delta events
        if (event.type === 'content-delta') {
          const text = event.delta?.message?.content?.text;
          if (text) yield text;
        }
      } catch (e) {
        // skip unparseable lines
      }
    }
  }
}

// ── Groq Streaming (OpenAI-compatible SSE) ──
async function* streamGroq(messages, maxTokens = 1000) {
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
      temperature: 0.3,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') return;
      
      try {
        const event = JSON.parse(jsonStr);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch (e) {
        // skip
      }
    }
  }
}
