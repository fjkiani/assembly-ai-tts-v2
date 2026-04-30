/**
 * POST /api/context
 *
 * Lightweight rolling memory store for interview context.
 * Phase 1 goal: preserve conversation continuity beyond short turn windows.
 */

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const MAX_EVENTS = 80;
const QUESTION_MARKERS = ['?', 'can you', 'how would', 'what would', 'walk me through', 'let us', "let's"];

/** @type {Map<string, { updatedAt: number, version: number, events: Array<any>, activeContext: string }>} */
const sessionStore = globalThis.__zetaSessionStore || new Map();
globalThis.__zetaSessionStore = sessionStore;

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}

function compact(text, max = 280) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function buildContext(events = []) {
  if (events.length === 0) {
    return 'No prior conversation context yet.';
  }

  const recent = events.slice(-10);
  const lastInterviewerTurns = recent.filter((e) => e.speaker === 'interviewer').slice(-3);
  const lastCandidateTurns = recent.filter((e) => e.speaker === 'candidate').slice(-3);

  const unresolvedQuestions = [];
  for (let i = 0; i < recent.length; i++) {
    const ev = recent[i];
    if (ev.speaker !== 'interviewer') continue;
    const lower = ev.text.toLowerCase();
    const looksQuestion = QUESTION_MARKERS.some((marker) => lower.includes(marker));
    if (!looksQuestion) continue;

    const answeredLater = recent.slice(i + 1).some((next) => next.speaker === 'candidate' && next.text.length > 24);
    if (!answeredLater) unresolvedQuestions.push(compact(ev.text, 160));
  }

  const activeThreadSeed = lastInterviewerTurns[lastInterviewerTurns.length - 1]?.text
    || lastCandidateTurns[lastCandidateTurns.length - 1]?.text
    || recent[recent.length - 1]?.text
    || '';

  const summary = recent
    .slice(-6)
    .map((e) => `${e.speaker === 'candidate' ? 'Me' : 'Interviewer'}: ${compact(e.text, 120)}`)
    .join(' | ');

  return [
    `Active thread: ${compact(activeThreadSeed, 220) || 'Unknown'}`,
    unresolvedQuestions.length > 0
      ? `Open loops: ${unresolvedQuestions.slice(0, 3).join(' || ')}`
      : 'Open loops: none detected in recent turns.',
    `Recent flow: ${summary}`,
  ].join('\n');
}

export async function POST(request) {
  try {
    cleanupExpiredSessions();
    const { sessionId, speaker = 'interviewer', text = '', kind = 'turn' } = await request.json();
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const existing = sessionStore.get(sessionId) || {
      updatedAt: Date.now(),
      version: 0,
      events: [],
      activeContext: 'No prior conversation context yet.',
    };

    if (kind !== 'peek' && text.trim()) {
      existing.events.push({
        speaker,
        text: text.trim(),
        ts: Date.now(),
      });
      if (existing.events.length > MAX_EVENTS) {
        existing.events = existing.events.slice(-MAX_EVENTS);
      }
    }

    existing.updatedAt = Date.now();
    existing.version += 1;
    existing.activeContext = buildContext(existing.events);
    sessionStore.set(sessionId, existing);

    return Response.json({
      sessionId,
      version: existing.version,
      activeContext: existing.activeContext,
      eventCount: existing.events.length,
    });
  } catch (err) {
    console.error('[context] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
