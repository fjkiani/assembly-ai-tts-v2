/**
 * useDebounceGate — Accumulates transcript turns and gates copilot firing
 * 
 * Responsibilities:
 *   - Accumulate end_of_turn text fragments into a full question
 *   - Debounce timer: flush after DEBOUNCE_MS of silence
 *   - Minimum word gate: skip filler like "Okay", "Alright" (< MIN_WORDS)
 *   - Copilot-in-flight requeue: wait if copilot is already streaming
 *   - Speaker tracking: uses AssemblyAI's native speaker_label passed from transcript processor
 *   - Expose accumulated preview text for UI display
 * 
 * Uses refs internally — immune to stale closures.
 */
'use client';

import { useRef, useState, useCallback } from 'react';

const DEBOUNCE_MS = 4000;
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;

export function useDebounceGate({ onFire, capabilitiesRef, copilotFiringRef, isStreamingRef }) {
  const accumulatedRef = useRef('');
  const speakerRef = useRef('interviewer'); // Track speaker for accumulated text
  const timerRef = useRef(null);
  const [previewText, setPreviewText] = useState('');

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

    console.log(`[debounce] Flushing (${speaker}):`, fullQuestion.slice(0, 100));

    // Fire with native AssemblyAI speaker label
    if (isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      console.log(`[gate] GATE_OPEN (${speaker}) — firing copilot`);
      onFire(fullQuestion, speaker);
    } else if (!capabilitiesRef.current.autoCopilot) {
      console.log('[gate] Auto-Copilot OFF — skipping auto-fire. Use manual trigger.');
    }
  }, [onFire, capabilitiesRef, copilotFiringRef, isStreamingRef]);

  // ── Accumulate: append end_of_turn text with speaker, reset debounce timer ──
  const accumulate = useCallback((text, speaker = 'interviewer') => {
    const prev = accumulatedRef.current;
    accumulatedRef.current = prev ? `${prev} ${text}` : text;
    speakerRef.current = speaker; // Use the latest speaker (from AssemblyAI's native label)
    setPreviewText(accumulatedRef.current);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  // ── Reset: clear everything (used by stop/burn-it) ──
  const reset = useCallback(() => {
    accumulatedRef.current = '';
    speakerRef.current = 'interviewer';
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPreviewText('');
  }, []);

  return { accumulate, flush, reset, previewText };
}
