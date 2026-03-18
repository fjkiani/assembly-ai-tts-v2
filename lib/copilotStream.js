/**
 * copilotStream — Async generator for copilot SSE streaming
 * 
 * Sends a question + history to the copilot API and yields tokens.
 * Works from both browser (relative URL) and Node.js (absolute URL).
 * 
 * Usage:
 *   for await (const event of streamCopilot({ question, history })) {
 *     if (event.token) appendToken(event.token);
 *     if (event.done) break;
 *   }
 */

/**
 * @param {Object} opts
 * @param {string} opts.question - The interviewer's question
 * @param {Array} opts.history - Previous { question, response, rawResponse } turns
 * @param {Object|null} opts.profilerState - Current profiler state
 * @param {Object} opts.clientTelemetry - { isRambling: boolean }
 * @param {string} [opts.baseUrl=''] - Base URL ('' for browser, 'http://localhost:3000' for Node)
 * @yields {{ token?: string, done?: boolean, error?: string }}
 */
export async function* streamCopilot({ question, history = [], profilerState = null, clipboardCode = '', terminalMode = false, clientTelemetry = {}, baseUrl = '' }) {
  const res = await fetch(`${baseUrl}/api/copilot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: question,
      history,
      profilerState,
      clipboardCode,
      terminalMode,
      clientTelemetry,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    yield { error: errData.error || `HTTP ${res.status}` };
    return;
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
      if (!jsonStr) continue;
      
      try {
        const event = JSON.parse(jsonStr);
        if (event.done) { yield { done: true }; return; }
        if (event.error) { yield { error: event.error }; return; }
        if (event.token) { yield { token: event.token }; }
      } catch (e) {
        // skip malformed SSE lines
      }
    }
  }
  yield { done: true };
}

/**
 * Convenience: stream copilot and return the full response text.
 * @returns {Promise<{ text: string, latencyMs: number }>}
 */
export async function fetchCopilotFull(opts) {
  const start = Date.now();
  let fullText = '';
  for await (const event of streamCopilot(opts)) {
    if (event.token) fullText += event.token;
    if (event.error) throw new Error(event.error);
    if (event.done) break;
  }
  return { text: fullText, latencyMs: Date.now() - start };
}
