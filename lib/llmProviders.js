/**
 * llmProviders.js — Centralized LLM streaming providers
 * 
 * Supports: Cohere, Groq, OpenAI (and any OpenAI-compatible API).
 * 
 * Usage:
 *   Set LLM_PROVIDER env var to: 'cohere' | 'groq' | 'openai'
 *   Each provider reads its own API key and model from env vars.
 * 
 * All providers export async generators that yield string tokens.
 * The route simply does: for await (const token of stream) { ... }
 */

/**
 * Get the configured LLM provider streaming function.
 * @returns {{ stream: Function, name: string }}
 */
export function getLLMProvider() {
  const provider = (process.env.LLM_PROVIDER || 'cohere').toLowerCase();
  
  switch (provider) {
    case 'groq':
      return { stream: streamGroq, name: 'groq' };
    case 'openai':
      return { stream: streamOpenAI, name: 'openai' };
    case 'cohere':
    default:
      return { stream: streamCohere, name: 'cohere' };
  }
}

// ── Cohere Streaming (v2 API) ──
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

  yield* streamOpenAICompatible({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: key,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages,
    maxTokens,
  });
}

// ── OpenAI Streaming ──
async function* streamOpenAI(messages, maxTokens = 1000) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  // Support custom base URL for OpenAI-compatible services
  // (OpenRouter, Together, Fireworks, Azure, local models, etc.)
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  yield* streamOpenAICompatible({
    url: `${baseUrl}/chat/completions`,
    apiKey: key,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    maxTokens,
  });
}

// ── Shared OpenAI-compatible streaming (Groq, OpenAI, OpenRouter, etc.) ──
async function* streamOpenAICompatible({ url, apiKey, model, messages, maxTokens }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM ${res.status}: ${errText}`);
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
