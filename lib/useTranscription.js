/**
 * useTranscription — Thin Orchestrator Hook
 * 
 * Wires together:
 *   - audioCapture.js  (mic + system audio)
 *   - speakerGate.js   (should we fire copilot?)
 *   - copilotStream.js (SSE streaming to /api/copilot)
 *   - profilerLoop.js  (60s background profiler)
 * 
 * This file owns: React state, refs, WebSocket lifecycle, debounce timer.
 * All business logic lives in the extracted modules.
 */
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { evaluateGate } from './speakerGate';
import { streamCopilot } from './copilotStream';
import { createProfilerLoop } from './profilerLoop';
import { captureMic, captureSystemAudio, createAudioPipeline, stopMediaStream } from './audioCapture';
import { DOMAIN_KEYTERMS } from './constants';

// ── Constants ──
const COOLDOWN_MS = 3000;
const DEBOUNCE_MS = 2500;

export function useTranscription(capabilities = {}) {
  // Destructure with defaults (RF1: keyterms/profiler are read at Start time via ref)
  const {
    terminalMode = false,
    clipboardCapture = true,
    autoStealth = true,
    keyterms = true,
    profiler = true,
    autoCopilot = true,
  } = capabilities;
  // RF1: Snapshot capabilities at connection time so mid-session toggles don't tear WS
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  // ── State ──
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [partialText, setPartialText] = useState('');
  const [bullets, setBullets] = useState([]);
  const [rawResponse, setRawResponse] = useState('');
  const [copilotLatency, setCopilotLatency] = useState(0);
  const [bulletHistory, setBulletHistory] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [held, setHeld] = useState(false);
  const [profilerState, setProfilerState] = useState(null);
  const [metrics, setMetrics] = useState({ turnCount: 0, avgLatency: 0, sessionDuration: 0 });
  const [clipboardCode, setClipboardCode] = useState('');

  // ── Refs ──
  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const displayStreamRef = useRef(null);
  const audioPipelineRef = useRef(null);
  const turnStartRef = useRef(null);
  const latenciesRef = useRef([]);
  const turnCountRef = useRef(0);
  const sessionStartRef = useRef(null);
  const sessionIntervalRef = useRef(null);
  const isStreamingRef = useRef(false);
  const bulletHistoryRef = useRef([]);
  const lastBulletsRef = useRef([]);
  const cooldownUntilRef = useRef(0);
  const heldRef = useRef(false);
  const profilerStateRef = useRef(null);
  const taggedTranscriptsRef = useRef([]);
  const lastProfilerTickRef = useRef(0);
  const profilerLoopRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const debounceTimerRef = useRef(null);
  const speakingStartRef = useRef(null);
  const clipboardCodeRef = useRef('');
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const authTokenRef = useRef(null);

  // ── Metrics updater ──
  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      turnCount: turnCountRef.current,
      sessionDuration: sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : 0,
    });
  }, []);

  // ── Clipboard Poller (Shadow IDE telemetry) ──
  // Gated by capabilities.clipboardCapture
  // RF3: Must check document.hasFocus() — unfocused reads throw DOMException
  useEffect(() => {
    const handleCopy = async () => {
      try {
        if (!capabilitiesRef.current.clipboardCapture) return; // Clipboard capture disabled
        if (!document.hasFocus()) return; // RF3: prevent DOMException on unfocused window
        const text = await navigator.clipboard.readText();
        // Only capture if it looks like code (has newlines + code chars, or starts with code keywords)
        const looksLikeCode = text && (
          (text.includes('\n') && /[{}();=]/.test(text)) ||
          /^(class|def|function|const|let|var|import|export|if|for|while|return)\b/m.test(text)
        );
        if (looksLikeCode) {
          clipboardCodeRef.current = text;
          setClipboardCode(text);
          console.log('[clipboard] Captured code:', text.slice(0, 60) + '...');
        }
      } catch {
        // Clipboard API requires focus + permissions — silent fail (RF3)
      }
    };
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, []);

  const toggleHold = useCallback(() => {
    heldRef.current = !heldRef.current;
    setHeld(heldRef.current);
  }, []);

  // ── Fire copilot (extracted as standalone async fn) ──
  const fireCopilot = useCallback(async (fullQuestion) => {
    try {
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
        history = allHistory; // Small enough — send everything
      } else {
        // Anchor: first 2 turns (problem statement + constraints)
        // Active: last 4 turns (immediate context)
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
      setStatus('listening');
    } catch (copilotErr) {
      console.error('[copilot] Error:', copilotErr);
      setBullets(['⚠ ' + copilotErr.message]);
      setStatus('listening');
    }
  }, []);

  // ── Debounce flush — runs after DEBOUNCE_MS of silence ──
  const flushDebounce = useCallback((now) => {
    const fullQuestion = accumulatedTranscriptRef.current.trim();
    accumulatedTranscriptRef.current = '';
    debounceTimerRef.current = null;

    if (!fullQuestion || !isStreamingRef.current) return;
    console.log('[debounce] Flushing:', fullQuestion.slice(0, 80) + '...');

    const { shouldFire, reason } = evaluateGate({
      held: heldRef.current,
      cooldownUntil: cooldownUntilRef.current,
      transcript: fullQuestion,
      lastBullets: lastBulletsRef.current,
    });

    console.log(`[gate] ${reason}`);

    // RF2: Only auto-fire if autoCopilot is ON
    if (shouldFire && isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      fireCopilot(fullQuestion); // fire-and-forget
    } else if (shouldFire && !capabilitiesRef.current.autoCopilot) {
      console.log('[gate] Auto-Copilot OFF — skipping auto-fire. Use manual trigger.');
    }
  }, [fireCopilot]);

  // ── Start ──
  const start = useCallback(async () => {
    // Reset all state
    setError(null); setTranscripts([]); setPartialText(''); setBullets([]);
    setBulletHistory([]); setRawResponse(''); setCopilotLatency(0);
    setHeld(false); setProfilerState(null);
    latenciesRef.current = []; profilerStateRef.current = null;
    taggedTranscriptsRef.current = []; lastProfilerTickRef.current = 0;
    turnCountRef.current = 0; turnStartRef.current = null;
    isStreamingRef.current = true; bulletHistoryRef.current = [];
    lastBulletsRef.current = []; cooldownUntilRef.current = 0;
    heldRef.current = false; accumulatedTranscriptRef.current = '';

    try {
      // 1. Capture audio
      setStatus('mic');
      const micStream = await captureMic();
      mediaStreamRef.current = micStream;

      const { stream: displayStream, audioStream: systemAudioStream } = await captureSystemAudio();
      if (displayStream) displayStreamRef.current = displayStream;

      // 2. Get auth token
      setStatus('auth');
      const tokenRes = await fetch('/api/token', { method: 'POST' });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.token) throw new Error(tokenData.error || 'Failed to get auth token');

      // 3. Open WebSocket with keyterms
      setStatus('connecting');
      const wsParams = new URLSearchParams({
        token: tokenData.token,
        sample_rate: '16000',
        speech_model: 'u3-rt-pro',
        language_detection: 'true',
      });
      // RF1: Keyterms evaluated at Start time only — toggling mid-session has no effect
      if (capabilitiesRef.current.keyterms && DOMAIN_KEYTERMS.length > 0) {
        wsParams.append('keyterms_prompt', JSON.stringify(DOMAIN_KEYTERMS));
        console.log(`[ws] Keyterms ENABLED: ${DOMAIN_KEYTERMS.length} terms injected`);
      } else {
        console.log('[ws] Keyterms DISABLED — no domain vocabulary injected');
      }
      const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('listening');
        setIsStreaming(true);
        sessionStartRef.current = Date.now();
        sessionIntervalRef.current = setInterval(updateMetrics, 1000);

        // RF1: Profiler evaluated at Start time only
        if (capabilitiesRef.current.profiler) {
          const profilerInst = createProfilerLoop({
            intervalMs: 60000,
            getTaggedTranscripts: () => taggedTranscriptsRef.current,
            getLastTick: () => lastProfilerTickRef.current,
            setLastTick: (n) => { lastProfilerTickRef.current = n; },
            getState: () => profilerStateRef.current,
            onUpdate: (newState) => {
              profilerStateRef.current = newState;
              setProfilerState(newState);
            },
          });
          profilerLoopRef.current = profilerInst;
          profilerInst.start();
          console.log('[profiler] Profiler loop STARTED');
        } else {
          console.log('[profiler] Profiler DISABLED — no background analysis');
        }
      };

      // 4. WebSocket message handler
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'Begin') {
            setStatus('listening');
          } else if (msg.type === 'Turn') {
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
              setPartialText('');

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

              // Debounce: accumulate, reset timer
              const prev = accumulatedTranscriptRef.current;
              accumulatedTranscriptRef.current = prev ? `${prev} ${transcript}` : transcript;

              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = setTimeout(flushDebounce, DEBOUNCE_MS);

            } else if (!endOfTurn && transcript.trim()) {
              setPartialText(transcript);
            }
          } else if (msg.type === 'Termination') {
            setStatus('ended');
            stopInternal();
          } else if (msg.type === 'Error') {
            setError(msg.error || 'Streaming error');
            stopInternal();
          }
        } catch (parseErr) {
          console.error('[ws] parse error:', parseErr);
        }
      };

      ws.onerror = () => { setError('WebSocket connection error'); };
      ws.onclose = (closeEvent) => {
        if (!isStreamingRef.current) return;
        const code = closeEvent?.code || 0;
        console.log(`[ws] CLOSED code=${code} reason=${closeEvent?.reason || 'none'}`);
        setStatus('disconnected');

        // BS1: Exponential Backoff Auto-Reconnect (max 3 attempts)
        const MAX_RECONNECT = 3;
        const attempt = reconnectAttemptsRef.current;
        if (attempt < MAX_RECONNECT) {
          const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`[ws] Reconnect attempt ${attempt + 1}/${MAX_RECONNECT} in ${delayMs}ms...`);
          setError(`WS disconnected (code ${code}). Reconnecting ${attempt + 1}/${MAX_RECONNECT}...`);
          reconnectAttemptsRef.current = attempt + 1;
          reconnectTimerRef.current = setTimeout(async () => {
            try {
              // Re-auth
              const tokenRes = await fetch('/api/token', { method: 'POST' });
              const tokenData = await tokenRes.json();
              if (!tokenRes.ok || !tokenData.token) throw new Error('Re-auth failed');

              const wsParams = new URLSearchParams({
                token: tokenData.token,
                sample_rate: '16000',
                speech_model: 'u3-rt-pro',
                language_detection: 'true',
              });
              if (capabilitiesRef.current.keyterms && DOMAIN_KEYTERMS.length > 0) {
                wsParams.append('keyterms_prompt', JSON.stringify(DOMAIN_KEYTERMS));
              }
              const newWs = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`);
              wsRef.current = newWs;
              newWs.onopen = () => {
                setStatus('listening');
                setError(null);
                reconnectAttemptsRef.current = 0;
                console.log('[ws] Reconnected successfully!');
                // Re-attach audio pipeline
                if (audioPipelineRef.current) audioPipelineRef.current.updateWs(newWs);
              };
              newWs.onmessage = ws.onmessage; // Reuse same handler
              newWs.onerror = ws.onerror;
              newWs.onclose = ws.onclose; // Recursive reconnect
            } catch (reconnErr) {
              console.error('[ws] Reconnect failed:', reconnErr);
              setError(`Reconnect failed: ${reconnErr.message}. Manual restart required.`);
              stopInternal();
            }
          }, delayMs);
        } else {
          setError(`WS disconnected (code ${code}). Max reconnect attempts reached. Click STOP then START.`);
          stopInternal();
        }
      };

      // 5. Audio pipeline
      const pipeline = createAudioPipeline({ micStream, systemAudioStream, ws });
      audioPipelineRef.current = pipeline;

    } catch (err) {
      setError(err.message);
      stopInternal();
    }
  }, [updateMetrics, flushDebounce]);

  // ── Stop ──
  const stopInternal = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);

    if (sessionIntervalRef.current) { clearInterval(sessionIntervalRef.current); sessionIntervalRef.current = null; }
    if (profilerLoopRef.current) { profilerLoopRef.current.stop(); profilerLoopRef.current = null; }

    try { if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'Terminate' }));
      wsRef.current.close(); wsRef.current = null;
    }} catch {}

    if (audioPipelineRef.current) { audioPipelineRef.current.cleanup(); audioPipelineRef.current = null; }
    stopMediaStream(mediaStreamRef.current); mediaStreamRef.current = null;
    stopMediaStream(displayStreamRef.current); displayStreamRef.current = null;

    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    accumulatedTranscriptRef.current = '';
    speakingStartRef.current = null;
    updateMetrics();
  }, [updateMetrics]);

  const stop = useCallback(() => { stopInternal(); setStatus('idle'); }, [stopInternal]);

  // BS2: "Burn It" — flush active context without stopping the session
  const flushActiveContext = useCallback(() => {
    console.log('[flush] Burning active context');
    setRawResponse('');
    setBullets([]);
    setPartialText('');
    accumulatedTranscriptRef.current = '';
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    // Remove last history entry if it exists (poison removal)
    if (bulletHistoryRef.current.length > 0) {
      bulletHistoryRef.current.pop();
      setBulletHistory([...bulletHistoryRef.current]);
    }
    setStatus('listening');
  }, []);

  return {
    isStreaming, transcripts, partialText, bullets, rawResponse,
    copilotLatency, bulletHistory, metrics, status, error,
    held, speakingStartRef, profilerState,
    start, stop, toggleHold, flushActiveContext,
  };
}
