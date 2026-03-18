/**
 * speakerGate — Pure function speaker filtering
 * 
 * Determines whether a transcript should fire the copilot or be suppressed.
 * Three gates:
 *   1. Manual hold (spacebar)
 *   2. Cooldown (candidate speaking window after copilot response)
 *   3. Echo detection (candidate reading copilot bullets back)
 * 
 * Zero React deps. Pure input → output.
 */

/**
 * Compute word overlap ratio between transcript and last copilot bullets.
 * Returns 0-1 (0 = no overlap, 1 = all transcript words match bullets).
 */
export function computeWordOverlap(transcriptText, lastBullets) {
  if (!lastBullets || lastBullets.length === 0) return 0;
  
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const transcriptWords = new Set(normalize(transcriptText));
  const bulletWords = new Set(lastBullets.flatMap(b => normalize(b)));
  
  if (transcriptWords.size === 0 || bulletWords.size === 0) return 0;
  
  let overlap = 0;
  for (const w of transcriptWords) {
    if (bulletWords.has(w)) overlap++;
  }
  
  return overlap / transcriptWords.size;
}

/**
 * Evaluate all speaker gates. Returns { shouldFire: boolean, reason: string }.
 * 
 * @param {Object} opts
 * @param {boolean} opts.held - Manual hold active?
 * @param {number} opts.cooldownUntil - Timestamp: suppress until this time
 * @param {string} opts.transcript - The accumulated question text
 * @param {string[]} opts.lastBullets - Last copilot bullet texts
 * @param {number} [opts.similarityThreshold=0.4] - Echo detection threshold
 */
export function evaluateGate({ held, cooldownUntil, transcript, lastBullets, similarityThreshold = 0.4 }) {
  if (held) {
    return { shouldFire: false, reason: 'HELD' };
  }
  
  if (Date.now() < cooldownUntil) {
    return { shouldFire: false, reason: 'COOLDOWN' };
  }
  
  const overlap = computeWordOverlap(transcript, lastBullets);
  if (overlap > similarityThreshold) {
    return { shouldFire: false, reason: `ECHO (${(overlap * 100).toFixed(0)}% overlap)` };
  }
  
  return { shouldFire: true, reason: 'GATE_OPEN' };
}
