/**
 * useDebounceGate — Accumulates transcript turns and gates copilot firing
 * 
 * Responsibilities:
 *   - Accumulate end_of_turn text fragments into a full question
 *   - Debounce timer: flush after DEBOUNCE_MS of silence
 *   - Minimum word gate: skip filler like "Okay", "Alright" (< MIN_WORDS)
 *   - ECHO DETECTION: skip transcripts that are clearly Alpha reading copilot output verbatim
 *   - Copilot-in-flight requeue: wait if copilot is already streaming
 *   - Speaker tracking: uses AssemblyAI's native speaker_label
 * 
 * NOTE: No candidate turn suppression. The LLM's support mode prompt
 * handles candidate speech naturally — suppressing turns loses context.
 */
'use client';

import { useRef, useState, useCallback } from 'react';

const DEBOUNCE_MS = 4000;
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;
const ECHO_THRESHOLD = 0.70; // 70%+ match of significant words = verbatim echo
const MIN_WORD_LEN = 6;      // Only compare words 6+ chars (skip "the", "and", "this", "about")

export function useDebounceGate({ onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, lastCopilotOutputRef }) {
  const accumulatedRef = useRef('');
  const speakerRef = useRef('interviewer');
  const timerRef = useRef(null);
  const [previewText, setPreviewText] = useState('');

  /**
   * Echo detection: checks if Alpha is reading our copilot output VERBATIM.
   * Only matches on significant words (6+ chars) to avoid false positives
   * from normal domain vocabulary overlap.
   */
  const isEcho = useCallback((transcript) => {
    const lastOutput = lastCopilotOutputRef?.current || '';
    if (!lastOutput || lastOutput.length < 30) return false;

    // Extract significant words only (6+ chars, no common filler)
    const getSignificantWords = (text) =>
      new Set(text.toLowerCase().split(/\s+/).filter(w => w.length >= MIN_WORD_LEN));

    const transcriptWords = getSignificantWords(transcript);
    const outputWords = getSignificantWords(lastOutput);

    if (transcriptWords.size < 3) return false; // Too few significant words to judge

    let matchCount = 0;
    for (const word of transcriptWords) {
      if (outputWords.has(word)) matchCount++;
    }

    const similarity = matchCount / transcriptWords.size;
    if (similarity >= ECHO_THRESHOLD) {
      console.log(`[gate] ECHO DETECTED (${Math.round(similarity * 100)}% significant-word match) — suppressing.`);
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

    // ── Echo detection: skip if Alpha is reading our output verbatim ──
    if (isEcho(fullQuestion)) {
      return; // Already logged in isEcho()
    }

    console.log(`[debounce] Flushing (${speaker}):`, fullQuestion.slice(0, 100));

    // Fire — LLM prompt handles speaker-specific behavior (standard vs support mode)
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
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPreviewText('');
  }, []);

  return { accumulate, flush, reset, previewText };
}
