/**
 * useTranscriptProcessor — Handles WebSocket Turn messages
 * 
 * Responsibilities:
 *   - Process interim (partial) and final (end_of_turn) transcripts
 *   - Speaker tagging using AssemblyAI's native speaker label
 *   - Turn counting and latency tracking
 *   - Rambling detection (speaking > 90s)
 *   - Metrics calculation
 * 
 * Speaker Detection Strategy:
 *   - AssemblyAI v3 may use `speaker`, `speaker_label`, or neither
 *   - We check both fields with fallback
 *   - Lock to exactly 2 speaker ROLES (interviewer, candidate)
 *   - If AssemblyAI drifts labels (A→C, B→D), we remap new labels
 *     to the existing role based on adjacency (if last was interviewer,
 *     new unknown label is probably candidate, and vice versa)
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

  // Speaker tracking: exactly 2 roles, handle label drift
  const speakerMapRef = useRef({});         // { 'A': 'interviewer', 'B': 'candidate', 'C': 'interviewer', ... }
  const interviewerLabelRef = useRef(null); // The FIRST label assigned as interviewer
  const candidateLabelRef = useRef(null);   // The FIRST label assigned as candidate
  const lastSpeakerRoleRef = useRef(null);  // Last role that spoke (for adjacency mapping)

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
   * Extract speaker label from Turn message.
   * AssemblyAI v3 Pro: may use `speaker`, `speaker_label`, or both.
   * We check both with fallback.
   */
  const extractSpeakerLabel = (msg) => {
    return msg.speaker_label || msg.speaker || null;
  };

  /**
   * Map a speaker label to a ROLE (interviewer or candidate).
   * 
   * Strategy:
   *   - First distinct label = interviewer (they typically speak first)
   *   - Second distinct label = candidate
   *   - 3rd+ labels (label drift): map to the OPPOSITE role of whoever spoke last
   *     (if interviewer just spoke, new label is probably candidate, and vice versa)
   */
  const getSpeakerRole = useCallback((speakerLabel) => {
    if (!speakerLabel) return 'unknown';

    // Already mapped?
    if (speakerMapRef.current[speakerLabel]) {
      const role = speakerMapRef.current[speakerLabel];
      lastSpeakerRoleRef.current = role;
      return role;
    }

    // First speaker = interviewer
    if (!interviewerLabelRef.current) {
      interviewerLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'interviewer';
      lastSpeakerRoleRef.current = 'interviewer';
      console.log(`[speaker] Assigned label "${speakerLabel}" = INTERVIEWER (first speaker)`);
      return 'interviewer';
    }

    // Second speaker = candidate
    if (!candidateLabelRef.current) {
      candidateLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'candidate';
      lastSpeakerRoleRef.current = 'candidate';
      console.log(`[speaker] Assigned label "${speakerLabel}" = CANDIDATE (second speaker)`);
      return 'candidate';
    }

    // 3rd+ label = label drift. Map to opposite of last speaker.
    const driftRole = lastSpeakerRoleRef.current === 'interviewer' ? 'candidate' : 'interviewer';
    speakerMapRef.current[speakerLabel] = driftRole;
    lastSpeakerRoleRef.current = driftRole;
    console.log(`[speaker] LABEL DRIFT: new label "${speakerLabel}" mapped to ${driftRole.toUpperCase()} (opposite of last speaker)`);
    return driftRole;
  }, []);

  // ── Process a WebSocket Turn message ──
  const processMessage = useCallback((msg) => {
    if (msg.type === 'Turn') {
      const transcript = msg.transcript || msg.text || '';
      const endOfTurn = msg.end_of_turn ?? msg.is_final ?? false;
      const speakerLabel = extractSpeakerLabel(msg);

      // DEBUG: Log raw Turn message keys on first few turns to verify field names
      if (turnCountRef.current < 3) {
        console.log('[DEBUG Turn msg keys]', Object.keys(msg));
        console.log('[DEBUG Turn msg]', JSON.stringify({
          type: msg.type,
          speaker: msg.speaker,
          speaker_label: msg.speaker_label,
          transcript: (msg.transcript || '').slice(0, 40),
          text: (msg.text || '').slice(0, 40),
          end_of_turn: msg.end_of_turn,
          is_final: msg.is_final,
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

        // Get speaker role — handles label drift
        const speaker = getSpeakerRole(speakerLabel);
        const isCandidateSpeaking = speaker === 'candidate';

        setTranscripts(prev => [...prev, { 
          text: transcript, 
          id: Date.now(), 
          latency: sttLatency,
          speaker,
          speakerLabel, // raw AssemblyAI label
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
