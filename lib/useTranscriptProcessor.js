/**
 * useTranscriptProcessor — Handles WebSocket Turn messages
 * 
 * Responsibilities:
 *   - Process interim (partial) and final (end_of_turn) transcripts
 *   - Speaker tagging using AssemblyAI's NATIVE speaker_label (A/B), NOT a timer
 *   - Turn counting and latency tracking
 *   - Rambling detection (speaking > 90s)
 *   - Metrics calculation
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

  // Track speaker assignments: first speaker detected = interviewer (A), second = candidate
  // User can flip this via UI later if needed
  const speakerMapRef = useRef({}); // e.g., { 'A': 'interviewer', 'B': 'candidate' }
  const firstSpeakerRef = useRef(null);

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
   * Map AssemblyAI speaker_label to role.
   * First speaker detected = interviewer (in most interviews, the interviewer starts).
   * Second speaker = candidate (Alpha).
   */
  const getSpeakerRole = useCallback((speakerLabel) => {
    if (!speakerLabel) return 'unknown';

    // Already mapped?
    if (speakerMapRef.current[speakerLabel]) {
      return speakerMapRef.current[speakerLabel];
    }

    // First speaker we encounter = interviewer (they typically speak first)
    if (!firstSpeakerRef.current) {
      firstSpeakerRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'interviewer';
      console.log(`[speaker] Assigned speaker ${speakerLabel} = INTERVIEWER (first speaker)`);
      return 'interviewer';
    }

    // Second speaker = candidate
    speakerMapRef.current[speakerLabel] = 'candidate';
    console.log(`[speaker] Assigned speaker ${speakerLabel} = CANDIDATE (second speaker)`);
    return 'candidate';
  }, []);

  // ── Process a WebSocket Turn message ──
  const processMessage = useCallback((msg) => {
    if (msg.type === 'Turn') {
      const transcript = msg.transcript || '';
      const endOfTurn = msg.end_of_turn || false;
      const speakerLabel = msg.speaker_label || null; // Native AssemblyAI speaker label

      if (!turnStartRef.current && transcript.trim()) {
        turnStartRef.current = Date.now();
      }

      if (endOfTurn && transcript.trim()) {
        turnCountRef.current += 1;
        const sttLatency = turnStartRef.current ? Date.now() - turnStartRef.current : 0;
        latenciesRef.current.push(sttLatency);
        turnStartRef.current = null;

        // Get speaker role from AssemblyAI's native label
        const speaker = getSpeakerRole(speakerLabel);
        const isCandidateSpeaking = speaker === 'candidate';

        setTranscripts(prev => [...prev, { 
          text: transcript, 
          id: Date.now(), 
          latency: sttLatency,
          speaker,
          speakerLabel, // raw AssemblyAI label (A/B)
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
    firstSpeakerRef.current = null;
  }, []);

  return {
    processMessage, startSession, stopSession, resetAll,
    transcripts, partialText, setPartialText, metrics,
    taggedTranscriptsRef, speakingStartRef, speakerMapRef,
  };
}
