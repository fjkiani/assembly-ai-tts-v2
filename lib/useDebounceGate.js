'use client';
import { useRef, useState, useCallback } from 'react';

const DEBOUNCE_MS = 7000;
const CANDIDATE_DEBOUNCE_MS = 5000;
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;
const ECHO_THRESHOLD = 0.70;
const MIN_WORD_LEN = 9; // Raised from 6 — "binary","search","insert" are 6-8 chars and are legitimate candidate vocabulary

export function useDebounceGate({ onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, lastCopilotOutputRef }) {
  // Three explicit channels — never merges roles
  const interviewerAccRef = useRef('');
  const interviewerTimerRef = useRef(null);

  const candidateAccRef = useRef('');
  const candidateTimerRef = useRef(null);

  // Rescue fragment — set directly by triggerRescue(), bypasses debounce entirely
  const rescueFragmentRef = useRef(null);

  const [previewText, setPreviewText] = useState('');

  // Echo detection: only run on candidate channel
  // Raised MIN_WORD_LEN to 9 so technical vocabulary doesn't false-positive
  const isEcho = useCallback((transcript) => {
    const lastOutput = lastCopilotOutputRef?.current || '';
    if (!lastOutput || lastOutput.length < 30) return false;
    const getSignificantWords = (text) =>
      new Set(text.toLowerCase().split(/\s+/).filter(w => w.length >= MIN_WORD_LEN));
    const transcriptWords = getSignificantWords(transcript);
    const outputWords = getSignificantWords(lastOutput);
    if (transcriptWords.size < 3) return false;
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

  // flushChannel: fires the correct channel, applies gates, calls onFire
  const flushChannel = useCallback((speaker) => {
    const isCandidate = speaker === 'candidate';
    const accRef = isCandidate ? candidateAccRef : interviewerAccRef;
    const timerRef = isCandidate ? candidateTimerRef : interviewerTimerRef;

    const fullText = accRef.current.trim();

    // Copilot lock: if one is already in-flight, re-queue this channel
    if (copilotFiringRef.current) {
      console.log(`[debounce] Copilot in-flight — re-queuing ${speaker} channel in 2s`);
      timerRef.current = setTimeout(() => flushChannel(speaker), COPILOT_REQUEUE_MS);
      return;
    }

    // Clear channel state
    accRef.current = '';
    timerRef.current = null;
    setPreviewText('');

    if (!fullText || !isStreamingRef.current) return;

    // Minimum word gate
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < MIN_WORDS) {
      console.log(`[gate] NOISE (${speaker}) — only ${wordCount} word(s): "${fullText}" — skipping`);
      return;
    }

    // Echo detection — only on candidate channel
    if (isCandidate && isEcho(fullText)) {
      return; // Already logged in isEcho()
    }

    console.log(`[debounce] Flushing (${speaker}):`, fullText.slice(0, 100));

    if (isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      console.log(`[gate] GATE_OPEN (${speaker}) — firing copilot`);
      onFire(fullText, speaker);
    } else if (!capabilitiesRef.current.autoCopilot) {
      console.log('[gate] Auto-Copilot OFF — skipping auto-fire.');
    }
  }, [onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, isEcho]);

  // accumulate: routes to correct channel, NEVER merges roles
  const accumulate = useCallback((text, speaker = 'interviewer') => {
    if (speaker === 'candidate') {
      const prev = candidateAccRef.current;
      candidateAccRef.current = prev ? `${prev} ${text}` : text;
      setPreviewText(candidateAccRef.current);
      if (candidateTimerRef.current) clearTimeout(candidateTimerRef.current);
      candidateTimerRef.current = setTimeout(() => flushChannel('candidate'), CANDIDATE_DEBOUNCE_MS);
    } else {
      const prev = interviewerAccRef.current;
      interviewerAccRef.current = prev ? `${prev} ${text}` : text;
      setPreviewText(interviewerAccRef.current);
      if (interviewerTimerRef.current) clearTimeout(interviewerTimerRef.current);
      interviewerTimerRef.current = setTimeout(() => flushChannel('interviewer'), DEBOUNCE_MS);
    }
  }, [flushChannel]);

  // setRescueFragment: called by triggerRescue() — bypasses debounce entirely
  const setRescueFragment = useCallback((partialText) => {
    rescueFragmentRef.current = partialText;
  }, []);

  // flush: public method — flushes both channels (backward compat + manual flush)
  const flush = useCallback(() => {
    flushChannel('interviewer');
    flushChannel('candidate');
  }, [flushChannel]);

  // reset: clears all three channels
  const reset = useCallback(() => {
    interviewerAccRef.current = '';
    candidateAccRef.current = '';
    rescueFragmentRef.current = null;
    if (interviewerTimerRef.current) { clearTimeout(interviewerTimerRef.current); interviewerTimerRef.current = null; }
    if (candidateTimerRef.current) { clearTimeout(candidateTimerRef.current); candidateTimerRef.current = null; }
    setPreviewText('');
  }, []);

  return {
    accumulate,
    flush,
    reset,
    previewText,
    setRescueFragment,
    rescueFragmentRef,
    interviewerAccRef,
    candidateAccRef,
  };
}
