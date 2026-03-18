/**
 * profilerLoop — Background profiler interval manager
 * 
 * Runs every `intervalMs` (default 60s). Sends latest tagged transcripts
 * to /api/profiler and patches the profile state.
 * 
 * Zero React deps. Returns { start, stop } controller.
 */

/**
 * @param {Object} opts
 * @param {number} [opts.intervalMs=60000] - Profiler tick interval
 * @param {Function} opts.getTaggedTranscripts - () => string[] of tagged lines
 * @param {Function} opts.getLastTick - () => number (index of last sent chunk)
 * @param {Function} opts.setLastTick - (n: number) => void
 * @param {Function} opts.getState - () => object|null (current profiler state)
 * @param {Function} opts.onUpdate - (newState: object) => void
 * @param {string} [opts.baseUrl=''] - Base URL for fetch
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createProfilerLoop({
  intervalMs = 60000,
  getTaggedTranscripts,
  getLastTick,
  setLastTick,
  getState,
  onUpdate,
  baseUrl = '',
}) {
  let intervalId = null;

  async function tick() {
    const allTagged = getTaggedTranscripts();
    const lastTick = getLastTick();
    const latestChunk = allTagged.slice(lastTick);
    setLastTick(allTagged.length);

    if (latestChunk.length === 0) return;

    try {
      const res = await fetch(`${baseUrl}/api/profiler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentProfileState: getState(),
          latestChunk,
        }),
      });
      if (res.ok) {
        const newState = await res.json();
        onUpdate(newState);
        console.log('[profiler] Updated:', JSON.stringify(newState).slice(0, 100));
      }
    } catch (e) {
      console.warn('[profiler] Error (non-fatal):', e.message);
    }
  }

  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(tick, intervalMs);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    /** Fire one tick immediately (useful for testing) */
    tick,
  };
}
