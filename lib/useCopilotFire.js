/**
 * useCopilotFire — Handles copilot LLM firing, streaming, and history
 * 
 * Responsibilities:
 *   - Fire copilot via SSE streaming
 *   - Bookend Memory (first 2 turns + last 4)
 *   - Live bullet parsing during stream
 *   - History management (append, pop for burn-it)
 *   - Cooldown timer after response
 * 
 * Zero WebSocket knowledge. Pure copilot logic.
 */
'use client';

import { useRef, useState, useCallback } from 'react';
import { streamCopilot } from './copilotStream';

const COOLDOWN_MS = 3000;

export function useCopilotFire({ capabilitiesRef, profilerStateRef, clipboardCodeRef }) {
  const [bullets, setBullets] = useState([]);
  const [rawResponse, setRawResponse] = useState('');
  const [copilotLatency, setCopilotLatency] = useState(0);
  const [bulletHistory, setBulletHistory] = useState([]);
  const [activeQuestion, setActiveQuestion] = useState('');
  const [status, setStatus] = useState('idle'); // thinking | streaming | listening

  const bulletHistoryRef = useRef([]);
  const lastBulletsRef = useRef([]);
  const lastCopilotOutputRef = useRef(''); // For echo detection in debounce gate
  const cooldownUntilRef = useRef(0);
  const copilotFiringRef = useRef(false);
  const speakingStartRefBridge = useRef(null); // Injected by useTranscription after transcript processor created

  const fire = useCallback(async (fullQuestion, speaker = 'interviewer', { rescue = false } = {}) => {
    copilotFiringRef.current = true;
    try {
      setActiveQuestion(fullQuestion);
      setStatus('thinking');
      setBullets([]);
      setRawResponse('');
      const copilotStart = Date.now();

      // ── Bookend Memory: anchor turns 1-2 + active window (last 4) ──
      const allHistory = bulletHistoryRef.current.map(h => ({
        question: h.question,
        response: h.bullets,
        rawResponse: h.rawResponse,
      }));
      let history;
      if (allHistory.length <= 6) {
        history = allHistory;
      } else {
        history = [...allHistory.slice(0, 2), ...allHistory.slice(-4)];
      }

      let fullText = ''; // Raw LLM output (includes <THINK>/<PLAN>)
      setStatus('streaming');

      /**
       * Stream interceptor: strips <THINK>...</THINK> and <PLAN>...</PLAN>
       * from the visible UI while preserving them in the raw stream for debugging.
       */
      const stripHiddenBlocks = (text) => {
        return text
          .replace(/<THINK>[\s\S]*?<\/THINK>\s*/g, '')  // Strip completed THINK blocks
          .replace(/<PLAN>[\s\S]*?<\/PLAN>\s*/g, '')    // Strip completed PLAN blocks
          .replace(/<THINK>[\s\S]*$/g, '')               // Strip incomplete THINK (still streaming)
          .replace(/<PLAN>[\s\S]*$/g, '')                // Strip incomplete PLAN (still streaming)
          .trim();
      };

      // Compute isRambling ONCE for this fire, then reset the timer
      const isRambling = speakingStartRefBridge.current?.current
        && (Date.now() - speakingStartRefBridge.current.current) / 1000 >= 90;
      // Reset rambling timer — each copilot fire resets the 90s clock
      if (speakingStartRefBridge.current?.current) {
        speakingStartRefBridge.current.current = Date.now();
      }

      for await (const event of streamCopilot({
        question: fullQuestion,
        speaker,
        history,
        profilerState: profilerStateRef.current,
        clipboardCode: clipboardCodeRef.current || '',
        terminalMode: capabilitiesRef.current.terminalMode || false,
        clientTelemetry: { isRambling, isRescue: rescue },
      })) {
        if (event.error) throw new Error(event.error);
        if (event.token) {
          fullText += event.token;
          // Strip hidden reasoning blocks before rendering to UI
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

      // Final render: strip hidden blocks from the completed response
      const visibleFinal = stripHiddenBlocks(fullText);
      const finalBullets = visibleFinal.split('\n')
        .map(l => l.replace(/^[\s•\-\*\d.)+]+/, '').trim())
        .filter(l => l.length > 0)
        .slice(0, 10);

      setBullets(finalBullets);
      setRawResponse(visibleFinal);

      // Update gate state
      lastBulletsRef.current = finalBullets;
      lastCopilotOutputRef.current = visibleFinal; // Store for echo detection
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
  }, [capabilitiesRef, profilerStateRef, clipboardCodeRef]);

  // BS2: "Burn It" — flush active context without stopping session
  const flushActiveContext = useCallback(() => {
    console.log('[flush] Burning active context');
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
    setStatus('idle');
  }, []);

  return {
    fire, flushActiveContext, resetAll,
    bullets, rawResponse, copilotLatency, bulletHistory, activeQuestion,
    copilotStatus: status,
    // Refs exposed for gate/debounce
    copilotFiringRef, lastBulletsRef, lastCopilotOutputRef, cooldownUntilRef, bulletHistoryRef,
    speakingStartRefBridge, // Bridge ref: set to transcript.speakingStartRef by orchestrator
  };
}
