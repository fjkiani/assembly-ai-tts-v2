/**
 * detectCodingPhase.js — 3-Layer Terminal Mode Detector
 * 
 * Determines if the copilot should switch to Terminal Mode (code-focused HUD)
 * instead of the standard tactical HUD. Uses three independent signals:
 * 
 * Layer 1: Profiler phase (fuzzy match against coding-related phases)
 * Layer 2: Transcript heuristics (keyword density in the current question)
 * Layer 3: Manual override (client sends explicit terminalMode flag)
 * 
 * Any single layer returning true activates Terminal Mode.
 * Layer 2 uses a weighted scoring system to avoid false positives.
 */

// ── Layer 1: Profiler Phase Fuzzy Match ──
// The profiler LLM outputs conversation_phase as a free-text string.
// We match against a set of known coding-related phases (case-insensitive, partial match).
const CODING_PHASES = [
  'coding',
  'code',
  'live_coding',
  'live coding',
  'pair_programming',
  'pair programming',
  'code_review',
  'code review',
  'implementation',
  'algorithm',
  'data_structure',
  'whiteboard',
  'leetcode',
  'coderpad',
  'debugging',
];

function matchesProfilerPhase(profilerState) {
  const phase = (profilerState?.conversation_phase || '').toLowerCase().trim();
  if (!phase) return false;
  return CODING_PHASES.some(cp => phase.includes(cp));
}

// ── Layer 2: Transcript Keyword Heuristics ──
// Detects coding-related language in the current question/transcript.
// Uses weighted scoring: high-signal keywords (explicit code requests) score 3,
// medium-signal (technical terms) score 2, low-signal (general tech) score 1.
// Threshold of 4 prevents false positives from casual tech talk.

const HIGH_SIGNAL = [
  // Explicit code requests
  'implement', 'write a function', 'write code', 'code this',
  'write a method', 'write a class', 'write the code',
  'can you code', 'let me code', "let's code",
  'optimize this', 'optimize that', 'refactor',
  'what is the time complexity', 'what is the space complexity',
  'big o', 'brute force', 'edge case', 'edge cases',
  'run this code', 'compile', 'debug this', 'trace through',
  'dry run', 'walk through the code',
];

const MEDIUM_SIGNAL = [
  // Data structures & algorithms
  'binary search', 'linked list', 'hash map', 'hash table',
  'binary tree', 'graph', 'dfs', 'bfs', 'dynamic programming',
  'recursion', 'recursive', 'iterate', 'traversal',
  'sort', 'merge sort', 'quick sort', 'heap',
  'stack', 'queue', 'array', 'matrix',
  'two pointer', 'sliding window', 'monotonic',
  // OOP
  'class', 'inherit', 'interface', 'abstract',
  'constructor', 'method', 'getter', 'setter',
  'polymorphism', 'encapsulation',
];

const LOW_SIGNAL = [
  // General tech that alone isn't enough
  'function', 'variable', 'loop', 'return',
  'string', 'integer', 'boolean', 'null',
  'api', 'endpoint', 'database', 'query',
];

function scoreTranscript(transcript) {
  if (!transcript) return 0;
  const lower = transcript.toLowerCase();
  let score = 0;

  for (const kw of HIGH_SIGNAL) {
    if (lower.includes(kw)) score += 3;
  }
  for (const kw of MEDIUM_SIGNAL) {
    if (lower.includes(kw)) score += 2;
  }
  for (const kw of LOW_SIGNAL) {
    if (lower.includes(kw)) score += 1;
  }

  return score;
}

const TRANSCRIPT_THRESHOLD = 4; // Minimum score to trigger

function matchesTranscriptHeuristics(transcript) {
  return scoreTranscript(transcript) >= TRANSCRIPT_THRESHOLD;
}

// ── Layer 3: Clipboard Presence ──
// If we have code in the clipboard, it's strong evidence we're in a coding context.
function hasClipboardCode(clipboardCode) {
  return !!(clipboardCode && clipboardCode.trim().length > 50);
}

// ── Public API ──

/**
 * Determine if Terminal Mode should be active.
 * 
 * @param {Object} opts
 * @param {Object|null} opts.profilerState - Current profiler state
 * @param {string} opts.transcript - The current question/transcript
 * @param {string} opts.clipboardCode - Code from the clipboard (if any)
 * @param {boolean} opts.manualTerminalMode - Explicit UI toggle
 * @returns {{ active: boolean, reason: string, score: number }}
 */
export function detectCodingPhase({ profilerState, transcript, clipboardCode, manualTerminalMode }) {
  // Layer 3: Manual override is absolute
  if (manualTerminalMode) {
    return { active: true, reason: 'manual_override', score: 100 };
  }

  // Layer 1: Profiler phase
  if (matchesProfilerPhase(profilerState)) {
    return { active: true, reason: 'profiler_phase', score: 80 };
  }

  // Layer 2: Transcript keywords
  const transcriptScore = scoreTranscript(transcript);
  if (transcriptScore >= TRANSCRIPT_THRESHOLD) {
    // Boost confidence if clipboard code is also present
    const boosted = hasClipboardCode(clipboardCode);
    return {
      active: true,
      reason: boosted ? 'transcript_keywords+clipboard' : 'transcript_keywords',
      score: Math.min(transcriptScore + (boosted ? 20 : 0), 100),
    };
  }

  // Layer 2b: Clipboard alone (weaker signal, needs at least SOME tech talk)
  if (hasClipboardCode(clipboardCode) && transcriptScore >= 2) {
    return { active: true, reason: 'clipboard+weak_transcript', score: 40 };
  }

  return { active: false, reason: 'none', score: 0 };
}
