'use client';
import { useRef, useState, useCallback } from 'react';
import { streamCopilot } from './copilotStream';
import { detectCodingPhase } from './detectCodingPhase';

const COOLDOWN_MS = 3000;

export function useCopilotFire({ capabilitiesRef, profilerStateRef, clipboardCodeRef, turnLogRef, lastPartialRef }) {
  const [bullets, setBullets] = useState([]);
  const [rawResponse, setRawResponse] = useState('');
  const [copilotLatency, setCopilotLatency] = useState(0);
  const [bulletHistory, setBulletHistory] = useState([]);
  const [activeQuestion, setActiveQuestion] = useState('');
  const [status, setStatus] = useState('idle');

  const bulletHistoryRef = useRef([]);
  const lastBulletsRef = useRef([]);
  const lastCopilotOutputRef = useRef('');
  const cooldownUntilRef = useRef(0);
  const copilotFiringRef = useRef(false);
  const speakingStartRefBridge = useRef(null);

  const codingPhaseRef = useRef({ active: false, reason: 'none', score: 0 });
  const topicAnchorRef = useRef(null);   // First interviewer turn with >8 words — the active problem
  const activeTurnRef = useRef(null);    // turn_order of the turn currently being processed
  const wsUpdateConfigRef = useRef(null); // Injected by useTranscription: ws.updateConfiguration

  // Build LLM history from normalized turn log (sorted by turn_order), not from prior copilot outputs
  const buildTurnHistory = useCallback(() => {
    const turnLog = turnLogRef?.current || [];
    // Take last 8 turns, already sorted by turn_order
    return turnLog.slice(-8).map(t => ({
      role: t.speaker_role === 'interviewer' ? 'interviewer' : 'candidate',
      turn_order: t.turn_order,
      text: t.transcript,
      avg_confidence: t.avg_confidence,
    }));
  }, [turnLogRef]);

  // Update topic anchor: first interviewer turn with >8 words becomes the active problem
  const updateTopicAnchor = useCallback((turnEvent) => {
    if (turnEvent.speaker_role !== 'interviewer') return;
    const wordCount = turnEvent.transcript.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount > 8 && !topicAnchorRef.current) {
      topicAnchorRef.current = turnEvent.transcript;
      console.log('[copilot] Topic anchor set:', topicAnchorRef.current.slice(0, 60));
    }
  }, []);

  const fire = useCallback(async (fullQuestion, speaker = 'interviewer', { rescue = false } = {}) => {
    copilotFiringRef.current = true;
    try {
      // Detect coding phase from 3 layers: profiler, transcript keywords, clipboard
      const codingDetection = detectCodingPhase({
        profilerState: profilerStateRef.current,
        transcript: fullQuestion,
        clipboardCode: clipboardCodeRef.current || '',
        manualTerminalMode: capabilitiesRef.current.terminalMode || false,
      });
      codingPhaseRef.current = codingDetection;

      // If coding phase just activated, push coding keyterms to WebSocket mid-session
      if (codingDetection.active) {
        const codingKeyterms = [
          'time complexity', 'space complexity', 'binary search', 'dynamic programming',
          'hash map', 'linked list', 'binary tree', 'depth first search', 'breadth first search',
          'sliding window', 'two pointer', 'monotonic stack', 'memoization', 'recursion',
        ];
        wsUpdateConfigRef.current?.({ keyterms_prompt: codingKeyterms });
        console.log('[copilot] Coding phase active — pushed keyterms to WS:', codingDetection.reason);
      }

      setActiveQuestion(fullQuestion);
      setStatus('thinking');
      setBullets([]);
      setRawResponse('');
      const copilotStart = Date.now();

      // Build history from normalized turn log (turn_order sorted), not from prior copilot outputs
      const turnHistory = buildTurnHistory();

      // Bookend: anchor turns 1-2 + active window (last 4) — applied to turn history
      let history;
      if (turnHistory.length <= 6) {
        history = turnHistory;
      } else {
        history = [...turnHistory.slice(0, 2), ...turnHistory.slice(-4)];
      }

      // Also keep bulletHistoryRef updated for backward compat (profiler, post-session)
      const allBulletHistory = bulletHistoryRef.current.map(h => ({
        question: h.question,
        response: h.bullets,
        rawResponse: h.rawResponse,
      }));

      let fullText = '';
      setStatus('streaming');

      const stripHiddenBlocks = (text) => {
        return text
          .replace(/<THINK>[\s\S]*?<\/THINK>\s*/g, '')
          .replace(/<PLAN>[\s\S]*?<\/PLAN>\s*/g, '')
          .replace(/<THINK>[\s\S]*$/g, '')
          .replace(/<PLAN>[\s\S]*$/g, '')
          .trim();
      };

      const isRambling = speakingStartRefBridge.current?.current
        && (Date.now() - speakingStartRefBridge.current.current) / 1000 >= 90;
      if (speakingStartRefBridge.current?.current) {
        speakingStartRefBridge.current.current = Date.now();
      }

      for await (const event of streamCopilot({
        question: fullQuestion,
        speaker,
        history,
        topicAnchor: topicAnchorRef.current,
        profilerState: profilerStateRef.current,
        clipboardCode: clipboardCodeRef.current || '',
        terminalMode: codingPhaseRef.current.active,
        clientTelemetry: { isRambling, isRescue: rescue },
      })) {
        if (event.error) throw new Error(event.error);
        if (event.token) {
          fullText += event.token;
          const visibleText = stripHiddenBlocks(fullText);
          setRawResponse(visibleText || 'Reasoning...');
          const liveBullets = visibleText.split('\n')
            .map(l => l.replace(/^[\s•\-\*\d.)+]+/, '').trim())
            .filter(l => l.length > 0);
          setBullets(liveBullets.slice(0, 10));
        }
        if (event.done) break;
      }

      const latency = Date.now() - copilotStart;
      setCopilotLatency(latency);

      const visibleFinal = stripHiddenBlocks(fullText);
      const finalBullets = visibleFinal.split('\n')
        .map(l => l.replace(/^[\s•\-\*\d.)+]+/, '').trim())
        .filter(l => l.length > 0)
        .slice(0, 10);

      setBullets(finalBullets);
      setRawResponse(visibleFinal);

      lastBulletsRef.current = finalBullets;
      lastCopilotOutputRef.current = visibleFinal;
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS;

      if (fullText.trim().length > 0) {
        const newEntry = {
          question: fullQuestion,
          bullets: finalBullets,
          rawResponse: fullText,
          latency,
          timestamp: Date.now(),
        };
        bulletHistoryRef.current.push(newEntry);
        setBulletHistory(prev => [...prev, newEntry]);
      }
      setActiveQuestion('');
      setStatus('listening');
    } catch (copilotErr) {
      console.error('[copilot] Error:', copilotErr);
      setBullets(['⚠ ' + copilotErr.message]);
      setStatus('listening');
    } finally {
      copilotFiringRef.current = false;
    }
  }, [capabilitiesRef, profilerStateRef, clipboardCodeRef, buildTurnHistory]);

  const flushActiveContext = useCallback(() => {
    setRawResponse('');
    setBullets([]);
    setActiveQuestion('');
    if (bulletHistoryRef.current.length > 0) {
      bulletHistoryRef.current.pop();
      setBulletHistory([...bulletHistoryRef.current]);
    }
    setStatus('listening');
  }, []);

  const resetAll = useCallback(() => {
    setBullets([]);
    setRawResponse('');
    setCopilotLatency(0);
    setBulletHistory([]);
    setActiveQuestion('');
    bulletHistoryRef.current = [];
    lastBulletsRef.current = [];
    cooldownUntilRef.current = 0;
    copilotFiringRef.current = false;
    topicAnchorRef.current = null;
    codingPhaseRef.current = { active: false, reason: 'none', score: 0 };
    setStatus('idle');
  }, []);

  return {
    fire, flushActiveContext, resetAll, updateTopicAnchor,
    bullets, rawResponse, copilotLatency, bulletHistory, activeQuestion,
    copilotStatus: status,
    copilotFiringRef, lastBulletsRef, lastCopilotOutputRef, cooldownUntilRef, bulletHistoryRef,
    speakingStartRefBridge,
    codingPhaseRef, topicAnchorRef, activeTurnRef, wsUpdateConfigRef,
  };
}
