/**
 * POST /api/followup
 * 
 * Post-Session Follow-Up Intelligence Generator
 * Called when Alpha clicks "Generate Follow-Up" after an interview session.
 * 
 * Accepts:
 *   { history: [...], profilerState: object|null }
 * 
 * Returns:
 *   SSE stream of markdown follow-up brief
 * 
 * Streaming. max_tokens: 1500. temperature: 0.4.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildFollowUpPrompt } from '../../../lib/buildSystemPrompt';

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
    const { history, profilerState } = await request.json();

    if (!history || history.length === 0) {
      return Response.json({ error: 'No conversation history to analyze' }, { status: 400 });
    }

    const kb = getKnowledgeBase();
    const systemPrompt = buildFollowUpPrompt(kb, profilerState || null);

    // Build the conversation transcript for analysis
    const messages = [{ role: 'system', content: systemPrompt }];

    // Flatten history into a readable transcript
    const transcript = history.map((h, i) => {
      const q = h.question || '(unknown question)';
      const a = h.rawResponse || (h.bullets || []).join('\n') || '(no response)';
      return `--- Turn ${i + 1} ---\nInterviewer: ${q}\nAlpha's HUD Response:\n${a}`;
    }).join('\n\n');

    messages.push({
      role: 'user',
      content: `Here is the full interview transcript (${history.length} turns):\n\n${transcript}\n\nGenerate the follow-up brief now.`,
    });

    const provider = (process.env.LLM_PROVIDER || 'cohere').toLowerCase();

    // ── Stream the response ──
    if (provider === 'groq') {
      return streamGroq(messages);
    } else {
      return streamCohere(messages);
    }
  } catch (err) {
    console.error('[followup] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function streamCohere(messages) {
  const key = process.env.COHERE_API_KEY;
  if (!key) return Response.json({ error: 'COHERE_API_KEY not configured' }, { status: 500 });

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.COHERE_MODEL || 'command-a-03-2025',
      messages,
      temperature: 0.4,
      max_tokens: 1500,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return Response.json({ error: `Cohere ${res.status}: ${errText}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
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
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === 'content-delta') {
                const token = event.delta?.message?.content?.text || '';
                if (token) controller.enqueue(encoder.encode(`data:${JSON.stringify({ token })}\n\n`));
              }
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ error: e.message })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data:${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

async function streamGroq(messages) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return Response.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.4,
      max_tokens: 1500,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return Response.json({ error: `Groq ${res.status}: ${errText}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
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
            if (jsonStr === '[DONE]') continue;
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr);
              const token = event.choices?.[0]?.delta?.content || '';
              if (token) controller.enqueue(encoder.encode(`data:${JSON.stringify({ token })}\n\n`));
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ error: e.message })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data:${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
