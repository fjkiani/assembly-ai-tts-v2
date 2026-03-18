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

export function useCopilotFire({ capabilitiesRef, profilerStateRef, clipboardCodeRef, speakingStartRef }) {
  const [bullets, setBullets] = useState([]);
  const [rawResponse, setRawResponse] = useState('');
  const [copilotLatency, setCopilotLatency] = useState(0);
  const [bulletHistory, setBulletHistory] = useState([]);
  const [activeQuestion, setActiveQuestion] = useState('');
  const [status, setStatus] = useState('idle'); // thinking | streaming | listening

  const bulletHistoryRef = useRef([]);
  const lastBulletsRef = useRef([]);
  const cooldownUntilRef = useRef(0);
  const copilotFiringRef = useRef(false);

  const fire = useCallback(async (fullQuestion) => {
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

      let fullText = '';
      setStatus('streaming');

      for await (const event of streamCopilot({
        question: fullQuestion,
        history,
        profilerState: profilerStateRef.current,
        clipboardCode: clipboardCodeRef.current || '',
        terminalMode: capabilitiesRef.current.terminalMode || false,
        clientTelemetry: {
          isRambling: speakingStartRef.current && (Date.now() - speakingStartRef.current) / 1000 >= 90,
        },
      })) {
        if (event.error) throw new Error(event.error);
        if (event.token) {
          fullText += event.token;
          setRawResponse(fullText);
          const liveBullets = fullText.split('\n')
            .map(l => l.replace(/^[\s•\-\*\d.)+]+/, '').trim())
            .filter(l => l.length > 0);
          setBullets(liveBullets.slice(0, 10));
        }
        if (event.done) break;
      }

      const latency = Date.now() - copilotStart;
      setCopilotLatency(latency);

      const finalBullets = fullText.split('\n')
        .map(l => l.replace(/^[\s•\-\*\d.)+]+/, '').trim())
        .filter(l => l.length > 0)
        .slice(0, 10);

      setBullets(finalBullets);
      setRawResponse(fullText);

      // Update gate state
      lastBulletsRef.current = finalBullets;
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
  }, [capabilitiesRef, profilerStateRef, clipboardCodeRef, speakingStartRef]);

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
    copilotFiringRef, lastBulletsRef, cooldownUntilRef, bulletHistoryRef,
  };
}
