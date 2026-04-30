/**
 * useTranscriptProcessor — Handles WebSocket Turn messages
 * 
 * Responsibilities:
 *   - Process interim (partial) and final (end_of_turn) transcripts
 *   - Speaker tagging using AssemblyAI's native speaker_label field
 *   - Turn counting and latency tracking
 *   - Rambling detection (speaking > 90s)
 *   - Metrics calculation
 * 
 * Speaker Detection (spec-aligned):
 *   - Reads msg.speaker_label directly (the only documented field).
 *   - Values: "A", "B", or "UNKNOWN" (< ~1s audio turns).
 *   - First non-UNKNOWN label = interviewer. Second = candidate.
 *   - "UNKNOWN" inherits lastSpeakerRoleRef (no new role created).
 *   - No adjacency heuristics, no timers, no fallback field names.
 * 
 * Doc refs:
 *   - Turn event schema: https://www.assemblyai.com/docs/streaming/universal-streaming/message-sequence
 *   - Diarization: https://www.assemblyai.com/docs/streaming/diarization-and-multichannel
 * 
 * Pure transcript processing — no copilot, no WebSocket management.
 */
'use client';

import { useRef, useState, useCallback } from 'react';

export function useTranscriptProcessor({ onEndOfTurn }) {
  const [transcripts, setTranscripts] = useState([]);
  const [partialText, setPartialText] = useState('');
  const [metrics, setMetrics] = useState({ turnCount: 0, avgLatency: 0, sessionDuration: 0 });

  const turnStartRef = useRef(null);
  const turnCountRef = useRef(0);
  const latenciesRef = useRef([]);
  const taggedTranscriptsRef = useRef([]);
  const speakingStartRef = useRef(null);
  const sessionStartRef = useRef(null);
  const sessionIntervalRef = useRef(null);

  // Speaker tracking: exactly 2 roles (interviewer, candidate)
  const speakerMapRef = useRef({});         // { 'A': 'interviewer', 'B': 'candidate' }
  const interviewerLabelRef = useRef(null); // First non-UNKNOWN label
  const candidateLabelRef = useRef(null);   // Second non-UNKNOWN label
  const lastSpeakerRoleRef = useRef(null);  // Last known role (for UNKNOWN inheritance)

  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      turnCount: turnCountRef.current,
      sessionDuration: sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : 0,
    });
  }, []);

  /**
   * Map a speaker_label to a ROLE (interviewer or candidate).
   *
   * Per AssemblyAI docs:
   *   - speaker_label is "A", "B", or "UNKNOWN"
   *   - "UNKNOWN" = turn had < ~1s audio, insufficient for diarization embedding
   *   - With max_speakers=2, only "A" and "B" should appear as real labels
   *
   * Strategy:
   *   - "UNKNOWN" → inherit lastSpeakerRoleRef (no new mapping created)
   *   - First non-UNKNOWN label → interviewer
   *   - Second non-UNKNOWN label → candidate
   *   - No adjacency heuristics. No 3rd+ role creation.
   */
  const getSpeakerRole = useCallback((speakerLabel) => {
    // Null/undefined — no label at all
    if (!speakerLabel) return lastSpeakerRoleRef.current || 'interviewer';

    // "UNKNOWN" — per docs: < ~1s audio, inherit last known speaker
    if (speakerLabel === 'UNKNOWN') {
      const inherited = lastSpeakerRoleRef.current || 'interviewer';
      console.log(`[speaker] UNKNOWN label — inheriting last known role: ${inherited}`);
      return inherited;
    }

    // Already mapped this label?
    if (speakerMapRef.current[speakerLabel]) {
      const role = speakerMapRef.current[speakerLabel];
      lastSpeakerRoleRef.current = role;
      return role;
    }

    // First non-UNKNOWN label = interviewer
    if (!interviewerLabelRef.current) {
      interviewerLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'interviewer';
      lastSpeakerRoleRef.current = 'interviewer';
      console.log(`[speaker] Assigned label "${speakerLabel}" = INTERVIEWER (first speaker)`);
      return 'interviewer';
    }

    // Second non-UNKNOWN label = candidate
    if (!candidateLabelRef.current) {
      candidateLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'candidate';
      lastSpeakerRoleRef.current = 'candidate';
      console.log(`[speaker] Assigned label "${speakerLabel}" = CANDIDATE (second speaker)`);
      return 'candidate';
    }

    // With max_speakers=2, we should never get here.
    // If we do, log it but don't invent heuristics — default to last known.
    console.warn(`[speaker] Unexpected 3rd label "${speakerLabel}" with max_speakers=2. Defaulting to last known: ${lastSpeakerRoleRef.current}`);
    return lastSpeakerRoleRef.current || 'interviewer';
  }, []);

  // ── Process a WebSocket Turn message ──
  const processMessage = useCallback((msg) => {
    if (msg.type === 'Turn') {
      // Spec fields only — no fallbacks
      const transcript = msg.transcript || '';
      const endOfTurn = msg.end_of_turn || false;
      const speakerLabel = msg.speaker_label || null;
      const languageCode = msg.language_code || null;       // Present when language_detection=true
      const words = msg.words || [];                        // Word-level timing + confidence

      // Compute turn duration from word timestamps (ms)
      const turnDurationMs = (words.length >= 2)
        ? words[words.length - 1].end - words[0].start
        : null;

      // DEBUG: Log raw Turn fields on first 5 turns (all spec fields)
      if (turnCountRef.current < 5) {
        console.log('[DEBUG Turn]', JSON.stringify({
          type: msg.type,
          speaker_label: speakerLabel,
          end_of_turn: endOfTurn,
          turn_order: msg.turn_order,
          transcript: transcript.slice(0, 50),
          language_code: languageCode,
          words_count: words.length,
          turn_duration_ms: turnDurationMs,
        }));
      }

      if (!turnStartRef.current && transcript.trim()) {
        turnStartRef.current = Date.now();
      }

      if (endOfTurn && transcript.trim()) {
        turnCountRef.current += 1;
        const sttLatency = turnStartRef.current ? Date.now() - turnStartRef.current : 0;
        latenciesRef.current.push(sttLatency);
        turnStartRef.current = null;

        // Speaker role from spec-documented speaker_label
        const speaker = getSpeakerRole(speakerLabel);
        const isCandidateSpeaking = speaker === 'candidate';

        setTranscripts(prev => [...prev, { 
          text: transcript, 
          id: Date.now(), 
          latency: sttLatency,
          speaker,
          speakerLabel,    // raw label for debugging
          languageCode,    // detected language (e.g. 'en', 'es')
          turnDurationMs,  // word-level duration (ms) or null
          wordCount: words.length,
        }]);

        // Speaker tagging for profiler
        taggedTranscriptsRef.current.push(`${isCandidateSpeaking ? 'Me' : 'Interviewer'}: ${transcript}`);
        console.log(`[speaker] ${speakerLabel || '?'} (${speaker}): ${transcript.slice(0, 80)}...`);

        // Rambling guard
        if (isCandidateSpeaking) {
          if (!speakingStartRef.current) speakingStartRef.current = Date.now();
        } else {
          speakingStartRef.current = null;
        }
        updateMetrics();

        // Delegate accumulation to the debounce gate — pass speaker role
        onEndOfTurn(transcript, speaker);
      } else if (!endOfTurn && transcript.trim()) {
        setPartialText(transcript);
      }
    }
  }, [onEndOfTurn, updateMetrics, getSpeakerRole]);

  // ── Session lifecycle ──
  const startSession = useCallback(() => {
    sessionStartRef.current = Date.now();
    sessionIntervalRef.current = setInterval(updateMetrics, 1000);
  }, [updateMetrics]);

  const stopSession = useCallback(() => {
    if (sessionIntervalRef.current) { clearInterval(sessionIntervalRef.current); sessionIntervalRef.current = null; }
    updateMetrics();
  }, [updateMetrics]);

  const resetAll = useCallback(() => {
    setTranscripts([]);
    setPartialText('');
    setMetrics({ turnCount: 0, avgLatency: 0, sessionDuration: 0 });
    turnStartRef.current = null;
    turnCountRef.current = 0;
    latenciesRef.current = [];
    taggedTranscriptsRef.current = [];
    speakingStartRef.current = null;
    sessionStartRef.current = null;
    speakerMapRef.current = {};
    interviewerLabelRef.current = null;
    candidateLabelRef.current = null;
    lastSpeakerRoleRef.current = null;
  }, []);

  return {
    processMessage, startSession, stopSession, resetAll,
    transcripts, partialText, setPartialText, metrics,
    taggedTranscriptsRef, speakingStartRef, speakerMapRef, lastSpeakerRoleRef,
  };
}
