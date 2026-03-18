/**
 * useDebounceGate — Accumulates transcript turns and gates copilot firing
 * 
 * Responsibilities:
 *   - Accumulate end_of_turn text fragments into a full question
 *   - Debounce timer: flush after DEBOUNCE_MS of silence
 *   - Minimum word gate: skip filler like "Okay", "Alright" (< MIN_WORDS)
 *   - CANDIDATE SUPPRESSION: don't fire when Alpha is speaking (let them talk!)
 *   - ECHO DETECTION: skip transcripts that match last copilot output
 *   - Copilot-in-flight requeue: wait if copilot is already streaming
 *   - Speaker tracking: uses AssemblyAI's native speaker_label
 * 
 * Uses refs internally — immune to stale closures.
 */
'use client';

import { useRef, useState, useCallback } from 'react';

const DEBOUNCE_MS = 4000;
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;
const ECHO_SIMILARITY_THRESHOLD = 0.4; // If 40%+ of words match last copilot output, it's an echo
const CANDIDATE_FIRE_ON_TURN = 2;      // Fire support mode on turn 2 (let them start, then help)
// After firing once, suppress until interviewer speaks again

export function useDebounceGate({ onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, lastCopilotOutputRef }) {
  const accumulatedRef = useRef('');
  const speakerRef = useRef('interviewer');
  const timerRef = useRef(null);
  const candidateTurnCountRef = useRef(0); // Track consecutive candidate turns
  const [previewText, setPreviewText] = useState('');

  /**
   * Echo detection: checks if the transcript is Alpha reading our copilot output aloud.
   * Compares word overlap between transcript and last copilot response.
   */
  const isEcho = useCallback((transcript) => {
    const lastOutput = lastCopilotOutputRef?.current || '';
    if (!lastOutput || lastOutput.length < 20) return false;

    const transcriptWords = new Set(transcript.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const outputWords = new Set(lastOutput.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    if (transcriptWords.size === 0) return false;

    let matchCount = 0;
    for (const word of transcriptWords) {
      if (outputWords.has(word)) matchCount++;
    }

    const similarity = matchCount / transcriptWords.size;
    if (similarity >= ECHO_SIMILARITY_THRESHOLD) {
      console.log(`[gate] ECHO DETECTED (${Math.round(similarity * 100)}% match) — Alpha is reading our output. Suppressing.`);
      return true;
    }
    return false;
  }, [lastCopilotOutputRef]);

  // ── Flush: fire if appropriate ──
  const flush = useCallback(() => {
    const fullQuestion = accumulatedRef.current.trim();
    const speaker = speakerRef.current;

    // Copilot lock: if one is already in-flight, re-queue
    if (copilotFiringRef.current) {
      console.log('[debounce] Copilot in-flight — re-queuing in 2s');
      timerRef.current = setTimeout(flush, COPILOT_REQUEUE_MS);
      return;
    }

    // Clear accumulated state
    accumulatedRef.current = '';
    timerRef.current = null;
    setPreviewText('');

    if (!fullQuestion || !isStreamingRef.current) return;

    // ── Minimum word gate: skip filler ──
    const wordCount = fullQuestion.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < MIN_WORDS) {
      console.log(`[gate] NOISE — only ${wordCount} word(s): "${fullQuestion}" — skipping`);
      return;
    }

    // ── Echo detection: skip if Alpha is reading our output aloud ──
    if (isEcho(fullQuestion)) {
      return; // Already logged in isEcho()
    }

    // ── CANDIDATE LOGIC: fire support mode ONCE, then shut up ──
    if (speaker === 'candidate') {
      candidateTurnCountRef.current += 1;
      if (candidateTurnCountRef.current < CANDIDATE_FIRE_ON_TURN) {
        // Turn 1: Let Alpha start their thought
        console.log(`[gate] CANDIDATE STARTING (turn ${candidateTurnCountRef.current}) — letting Alpha begin. Waiting.`);
        return;
      }
      if (candidateTurnCountRef.current === CANDIDATE_FIRE_ON_TURN) {
        // Turn 2: Fire support mode — help Alpha strengthen their answer
        console.log(`[gate] CANDIDATE SUPPORT — firing once to help Alpha (turn ${candidateTurnCountRef.current})`);
        // Fall through to fire below
      } else {
        // Turn 3+: Already helped. Suppress until interviewer speaks.
        console.log(`[gate] CANDIDATE CONTINUING (turn ${candidateTurnCountRef.current}) — already helped. Suppressed.`);
        return;
      }
    } else {
      // Interviewer speaking — reset candidate turn counter
      candidateTurnCountRef.current = 0;
    }

    console.log(`[debounce] Flushing (${speaker}):`, fullQuestion.slice(0, 100));

    // Fire with native AssemblyAI speaker label
    if (isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      console.log(`[gate] GATE_OPEN (${speaker}) — firing copilot`);
      onFire(fullQuestion, speaker);
    } else if (!capabilitiesRef.current.autoCopilot) {
      console.log('[gate] Auto-Copilot OFF — skipping auto-fire.');
    }
  }, [onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, isEcho]);

  // ── Accumulate: append end_of_turn text with speaker, reset debounce timer ──
  const accumulate = useCallback((text, speaker = 'interviewer') => {
    const prev = accumulatedRef.current;
    accumulatedRef.current = prev ? `${prev} ${text}` : text;
    speakerRef.current = speaker;
    setPreviewText(accumulatedRef.current);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  // ── Reset: clear everything (used by stop/burn-it) ──
  const reset = useCallback(() => {
    accumulatedRef.current = '';
    speakerRef.current = 'interviewer';
    candidateTurnCountRef.current = 0;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPreviewText('');
  }, []);

  return { accumulate, flush, reset, previewText };
}
