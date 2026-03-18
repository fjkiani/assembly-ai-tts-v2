/**
 * useTranscriptProcessor — Handles WebSocket Turn messages
 * 
 * Responsibilities:
 *   - Process interim (partial) and final (end_of_turn) transcripts
 *   - Speaker tagging (Me vs Interviewer based on cooldown)
 *   - Turn counting and latency tracking
 *   - Rambling detection (speaking > 90s)
 *   - Metrics calculation
 * 
 * Pure transcript processing — no copilot, no WebSocket management.
 */
'use client';

import { useRef, useState, useCallback } from 'react';

export function useTranscriptProcessor({ cooldownUntilRef, onEndOfTurn }) {
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

  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      turnCount: turnCountRef.current,
      sessionDuration: sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : 0,
    });
  }, []);

  // ── Process a WebSocket Turn message ──
  const processMessage = useCallback((msg) => {
    if (msg.type === 'Turn') {
      const transcript = msg.transcript || '';
      const endOfTurn = msg.end_of_turn || false;

      if (!turnStartRef.current && transcript.trim()) {
        turnStartRef.current = Date.now();
      }

      if (endOfTurn && transcript.trim()) {
        turnCountRef.current += 1;
        const sttLatency = turnStartRef.current ? Date.now() - turnStartRef.current : 0;
        latenciesRef.current.push(sttLatency);
        turnStartRef.current = null;

        setTranscripts(prev => [...prev, { text: transcript, id: Date.now(), latency: sttLatency }]);

        // Speaker tagging
        const isCandidateSpeaking = Date.now() < cooldownUntilRef.current;
        taggedTranscriptsRef.current.push(`${isCandidateSpeaking ? 'Me' : 'Interviewer'}: ${transcript}`);

        // Rambling guard
        if (isCandidateSpeaking) {
          if (!speakingStartRef.current) speakingStartRef.current = Date.now();
        } else {
          speakingStartRef.current = null;
        }
        updateMetrics();

        // Delegate accumulation to the debounce gate
        onEndOfTurn(transcript);
      } else if (!endOfTurn && transcript.trim()) {
        setPartialText(transcript);
      }
    }
  }, [cooldownUntilRef, onEndOfTurn, updateMetrics]);

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
  }, []);

  return {
    processMessage, startSession, stopSession, resetAll,
    transcripts, partialText, setPartialText, metrics,
    taggedTranscriptsRef, speakingStartRef,
  };
}
