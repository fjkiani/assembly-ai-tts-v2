'use client';
import { useRef, useState, useCallback } from 'react';

const computeAvgConfidence = (words) => {
  if (!words || words.length === 0) return 1.0;
  const finals = words.filter(w => w.word_is_final);
  if (finals.length === 0) return 1.0;
  return finals.reduce((sum, w) => sum + w.confidence, 0) / finals.length;
};

export function useTranscriptProcessor({ onFinalTurn, onPartial, onSpeechStarted, onEndOfTurn }) {
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

  const speakerMapRef = useRef({});
  const interviewerLabelRef = useRef(null);
  const candidateLabelRef = useRef(null);
  const lastSpeakerRoleRef = useRef(null);

  const turnLogRef = useRef([]); // normalized final turn events, sorted by turn_order
  const lastPartialRef = useRef(null);

  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      turnCount: turnCountRef.current,
      sessionDuration: sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : 0,
    });
  }, []);

  const extractSpeakerLabel = (msg) => {
    return msg.speaker_label || msg.speaker || null;
  };

  const getSpeakerRole = useCallback((speakerLabel) => {
    if (!speakerLabel) return 'unknown';
    if (speakerMapRef.current[speakerLabel]) {
      const role = speakerMapRef.current[speakerLabel];
      lastSpeakerRoleRef.current = role;
      return role;
    }
    if (!interviewerLabelRef.current) {
      interviewerLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'interviewer';
      lastSpeakerRoleRef.current = 'interviewer';
      return 'interviewer';
    }
    if (!candidateLabelRef.current) {
      candidateLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'candidate';
      lastSpeakerRoleRef.current = 'candidate';
      return 'candidate';
    }
    const driftRole = lastSpeakerRoleRef.current === 'interviewer' ? 'candidate' : 'interviewer';
    speakerMapRef.current[speakerLabel] = driftRole;
    lastSpeakerRoleRef.current = driftRole;
    return driftRole;
  }, []);

  const processMessage = useCallback((msg) => {
    if (msg.type === 'SpeechStarted') {
      const role = lastSpeakerRoleRef.current;
      onSpeechStarted?.({ timestamp_ms: msg.timestamp, confidence: msg.confidence, role });
    }

    if (msg.type === 'Turn') {
      const transcript = msg.transcript || msg.text || '';
      const endOfTurn = msg.end_of_turn ?? msg.is_final ?? false;
      const speakerLabel = extractSpeakerLabel(msg);

      if (!turnStartRef.current && transcript.trim()) {
        turnStartRef.current = Date.now();
      }

      if (endOfTurn && transcript.trim()) {
        turnCountRef.current += 1;
        const sttLatency = turnStartRef.current ? Date.now() - turnStartRef.current : 0;
        latenciesRef.current.push(sttLatency);
        turnStartRef.current = null;

        const speaker = getSpeakerRole(speakerLabel);
        const isCandidateSpeaking = speaker === 'candidate';

        const normalizedEvent = {
          type: 'turn',
          turn_order: msg.turn_order ?? turnCountRef.current,
          speaker_label: speakerLabel,
          speaker_role: speaker,
          transcript: transcript,
          end_of_turn: endOfTurn,
          words: msg.words || [],
          avg_confidence: computeAvgConfidence(msg.words),
          timestamp_ms: Date.now(),
          raw: msg,
        };

        setTranscripts(prev => [...prev, {
          text: transcript,
          id: Date.now(),
          latency: sttLatency,
          speaker,
          speakerLabel,
        }]);

        taggedTranscriptsRef.current.push(`${isCandidateSpeaking ? 'Me' : 'Interviewer'}: ${transcript}`);

        if (isCandidateSpeaking) {
          if (!speakingStartRef.current) speakingStartRef.current = Date.now();
        } else {
          speakingStartRef.current = null;
        }

        turnLogRef.current.push(normalizedEvent);
        turnLogRef.current.sort((a, b) => a.turn_order - b.turn_order);
        lastPartialRef.current = null;

        updateMetrics();
        onFinalTurn?.(normalizedEvent);
        // Backward compat: call onEndOfTurn if provided
        onEndOfTurn?.(transcript, speaker);
      } else if (!endOfTurn && transcript.trim()) {
        const speaker = getSpeakerRole(speakerLabel);

        const normalizedEvent = {
          type: 'turn',
          turn_order: msg.turn_order ?? turnCountRef.current,
          speaker_label: speakerLabel,
          speaker_role: speaker,
          transcript: transcript,
          end_of_turn: endOfTurn,
          words: msg.words || [],
          avg_confidence: computeAvgConfidence(msg.words),
          timestamp_ms: Date.now(),
          raw: msg,
        };

        lastPartialRef.current = normalizedEvent;
        setPartialText(transcript);
        onPartial?.(normalizedEvent);
      }
    }
  }, [onFinalTurn, onPartial, onSpeechStarted, onEndOfTurn, updateMetrics, getSpeakerRole]);

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
    turnLogRef.current = [];
    lastPartialRef.current = null;
  }, []);

  return {
    processMessage, startSession, stopSession, resetAll,
    transcripts, partialText, setPartialText, metrics,
    taggedTranscriptsRef, speakingStartRef, speakerMapRef, lastSpeakerRoleRef,
    turnLogRef, lastPartialRef,
  };
}
