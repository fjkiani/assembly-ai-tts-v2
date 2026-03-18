/**
 * speakerGate — Pure function speaker filtering + tagging
 * 
 * Determines whether a transcript should fire the copilot and WHO is speaking.
 * Three gates:
 *   1. Manual hold (spacebar)
 *   2. Echo detection (candidate reading copilot bullets back)
 *   3. Speaker tagging (interviewer vs candidate based on cooldown)
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
 * Evaluate speaker gates. Returns { shouldFire, speaker, reason }.
 * 
 * speaker: 'interviewer' | 'candidate'
 *   - interviewer: copilot generates answer-style response
 *   - candidate: copilot helps refine/support the candidate's answer
 * 
 * @param {Object} opts
 * @param {boolean} opts.held - Manual hold active?
 * @param {number} opts.cooldownUntil - Timestamp: candidate speaking window
 * @param {string} opts.transcript - The accumulated question text
 * @param {string[]} opts.lastBullets - Last copilot bullet texts
 * @param {number} [opts.similarityThreshold=0.4] - Echo detection threshold
 */
export function evaluateGate({ held, cooldownUntil, transcript, lastBullets, similarityThreshold = 0.4 }) {
  if (held) {
    return { shouldFire: false, speaker: null, reason: 'HELD' };
  }
  
  const overlap = computeWordOverlap(transcript, lastBullets);
  if (overlap > similarityThreshold) {
    return { shouldFire: false, speaker: 'candidate', reason: `ECHO (${(overlap * 100).toFixed(0)}% overlap)` };
  }

  // Speaker detection: if within cooldown window, the candidate is speaking
  const isCandidateSpeaking = Date.now() < cooldownUntil;
  const speaker = isCandidateSpeaking ? 'candidate' : 'interviewer';

  return { shouldFire: true, speaker, reason: `GATE_OPEN (${speaker})` };
}
