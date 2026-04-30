/**
 * POST /api/copilot
 * 
 * Streams LLM response via SSE (Server-Sent Events).
 * Each token arrives as a `data:` line. Client reads with ReadableStream.
 * 
 * Provider is set via LLM_PROVIDER env var (cohere | groq | openai).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTacticalPrompt, buildTerminalModePrompt, buildUserMessage } from '../../../lib/buildSystemPrompt';
import { getLLMProvider } from '../../../lib/llmProviders';

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
    const {
      text,
      speaker,
      history,
      profilerState,
      clipboardCode,
      terminalMode,
      clientTelemetry,
      activeContext,
      sessionId,
      contextVersion,
    } = await request.json();
    if (!text || !text.trim()) {
      return Response.json({ error: 'No text provided' }, { status: 400 });
    }

    const kb = getKnowledgeBase();

    // ── Terminal Mode: Manual UI toggle is absolute override ──
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
        const response = turn.rawResponse || (turn.response && turn.response.join('\n')) || '';
        if (response) {
          messages.push({ role: 'assistant', content: response });
        }
      }
    }

    messages.push({
      role: 'user',
      content: buildUserMessage(text, activeContext || '', clipboardCode || '', speaker || 'interviewer'),
    });

    if (activeContext) {
      console.log(
        `[copilot] context injected session=${sessionId || 'n/a'} v=${contextVersion || 0} chars=${activeContext.length}`
      );
    }

    // ── Stream from LLM (provider-agnostic) ──
    const provider = getLLMProvider();
    console.log(`[copilot] Using LLM provider: ${provider.name}`);
    const llmStream = await provider.stream(messages, maxTokens);

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
