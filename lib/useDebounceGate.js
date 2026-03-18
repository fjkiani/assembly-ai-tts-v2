/**
 * useDebounceGate — Accumulates transcript turns and gates copilot firing
 * 
 * Responsibilities:
 *   - Accumulate end_of_turn text fragments into a full question
 *   - Debounce timer: flush after DEBOUNCE_MS of silence
 *   - Minimum word gate: skip filler like "Okay", "Alright" (< MIN_WORDS)
 *   - Copilot-in-flight requeue: wait if copilot is already streaming
 *   - Expose accumulated preview text for UI display
 * 
 * Uses refs internally — immune to stale closures.
 */
'use client';

import { useRef, useState, useCallback } from 'react';
import { evaluateGate } from './speakerGate';

const DEBOUNCE_MS = 4000;
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;

export function useDebounceGate({ onFire, capabilitiesRef, heldRef, cooldownUntilRef, lastBulletsRef, copilotFiringRef, isStreamingRef }) {
  const accumulatedRef = useRef('');
  const timerRef = useRef(null);
  const [previewText, setPreviewText] = useState('');

  // ── Flush: evaluate gate and fire if appropriate ──
  const flush = useCallback(() => {
    const fullQuestion = accumulatedRef.current.trim();

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

    console.log('[debounce] Flushing:', fullQuestion.slice(0, 100));

    // Speaker gate evaluation — returns { shouldFire, speaker, reason }
    const { shouldFire, speaker, reason } = evaluateGate({
      held: heldRef.current,
      cooldownUntil: cooldownUntilRef.current,
      transcript: fullQuestion,
      lastBullets: lastBulletsRef.current,
    });

    console.log(`[gate] ${reason}`);

    // RF2: Only auto-fire if autoCopilot is ON
    if (shouldFire && isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      onFire(fullQuestion, speaker);
    } else if (shouldFire && !capabilitiesRef.current.autoCopilot) {
      console.log('[gate] Auto-Copilot OFF — skipping auto-fire. Use manual trigger.');
    }
  }, [onFire, capabilitiesRef, heldRef, cooldownUntilRef, lastBulletsRef, copilotFiringRef, isStreamingRef]);

  // ── Accumulate: append end_of_turn text, reset debounce timer ──
  const accumulate = useCallback((text) => {
    const prev = accumulatedRef.current;
    accumulatedRef.current = prev ? `${prev} ${text}` : text;
    setPreviewText(accumulatedRef.current);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  // ── Reset: clear everything (used by stop/burn-it) ──
  const reset = useCallback(() => {
    accumulatedRef.current = '';
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPreviewText('');
  }, []);

  return { accumulate, flush, reset, previewText };
}
