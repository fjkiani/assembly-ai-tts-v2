/**
 * useTranscription — Thin Orchestrator Hook
 * 
 * Wires together:
 *   - useWebSocket.js       (WS connection, reconnect)
 *   - useDebounceGate.js    (accumulate, word-count gate, flush timer)
 *   - useCopilotFire.js     (fire copilot, stream, bookend memory)
 *   - useTranscriptProcessor.js (Turn messages, speaker tagging, metrics)
 *   - audioCapture.js       (mic + system audio)
 *   - profilerLoop.js       (60s background profiler)
 * 
 * This file owns: start/stop lifecycle, capabilities ref, clipboard poller.
 * All business logic lives in the extracted modules.
 */
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from './useWebSocket';
import { useDebounceGate } from './useDebounceGate';
import { useCopilotFire } from './useCopilotFire';
import { useTranscriptProcessor } from './useTranscriptProcessor';
import { captureMic, captureSystemAudio, createAudioPipeline, stopMediaStream } from './audioCapture';
import { createProfilerLoop } from './profilerLoop';

export function useTranscription(capabilities = {}, sessionContext = null) {
  // RF1: Snapshot capabilities at connection time so mid-session toggles don't tear WS
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const sessionContextRef = useRef(sessionContext);
  sessionContextRef.current = sessionContext;

  // ── Shared state ──
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [held, setHeld] = useState(false);
  const [profilerState, setProfilerState] = useState(null);
  const [clipboardCode, setClipboardCode] = useState('');

  const isStreamingRef = useRef(false);
  const heldRef = useRef(false);
  const profilerStateRef = useRef(null);
  const clipboardCodeRef = useRef('');
  const mediaStreamRef = useRef(null);
  const displayStreamRef = useRef(null);
  const audioPipelineRef = useRef(null);
  const profilerLoopRef = useRef(null);
  const stopRef = useRef(null); // Forward ref so handleMessage can call stopInternal

  // ── Wire up sub-hooks ──

  // 1. Copilot Fire
  const copilot = useCopilotFire({
    capabilitiesRef,
    profilerStateRef,
    clipboardCodeRef,
    speakingStartRef: null, // Updated below after transcript processor is created
  });

  // 2. Debounce Gate
  const gate = useDebounceGate({
    onFire: copilot.fire,
    capabilitiesRef,
    heldRef,
    cooldownUntilRef: copilot.cooldownUntilRef,
    lastBulletsRef: copilot.lastBulletsRef,
    copilotFiringRef: copilot.copilotFiringRef,
    isStreamingRef,
  });

  // 3. Transcript Processor
  const transcript = useTranscriptProcessor({
    cooldownUntilRef: copilot.cooldownUntilRef,
    onEndOfTurn: gate.accumulate,
  });

  // Fix circular ref: copilot needs speakingStartRef from transcript processor
  // We can use a ref to bridge this — update copilot's internal ref
  copilot.speakingStartRefBridge.current = transcript.speakingStartRef;

  // 4. WebSocket — message handler dispatches to transcript processor
  const handleMessage = useCallback((msg) => {
    if (msg.type === 'Begin') {
      setStatus('listening');
    } else if (msg.type === 'Turn') {
      transcript.processMessage(msg);
    } else if (msg.type === 'Termination') {
      setStatus('ended');
      if (stopRef.current) stopRef.current();
    } else if (msg.type === 'Error') {
      setError(msg.error || 'Streaming error');
      if (stopRef.current) stopRef.current();
    }
  }, [transcript]);

  const handleStatusChange = useCallback((wsStatus) => {
    if (wsStatus === 'listening') {
      setStatus('listening');
      setError(null);
    } else if (wsStatus === 'disconnected') {
      setStatus('disconnected');
    } else if (wsStatus === 'error') {
      setError('WebSocket connection error');
    }
  }, []);

  const ws = useWebSocket({
    capabilitiesRef,
    sessionContextRef,
    onMessage: handleMessage,
    onStatusChange: handleStatusChange,
    audioPipelineRef,
  });

  // ── Clipboard Poller (RF3) ──
  useEffect(() => {
    const handleCopy = async () => {
      try {
        if (!capabilitiesRef.current.clipboardCapture) return;
        if (!document.hasFocus()) return;
        const text = await navigator.clipboard.readText();
        const looksLikeCode = text && (
          (text.includes('\n') && /[{}();=]/.test(text)) ||
          /^(class|def|function|const|let|var|import|export|if|for|while|return)\b/m.test(text)
        );
        if (looksLikeCode) {
          clipboardCodeRef.current = text;
          setClipboardCode(text);
          console.log('[clipboard] Captured code:', text.slice(0, 60) + '...');
        }
      } catch {}
    };
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, []);

  // ── Cleanup on page close/refresh — prevent zombie sessions ──
  // IMPORTANT: ws.disconnect is a stable useCallback ref, but ws (the object) changes
  // every render. Use a ref so this effect only runs once (mount/unmount).
  const wsDisconnectRef = useRef(ws.disconnect);
  wsDisconnectRef.current = ws.disconnect;

  useEffect(() => {
    const handleUnload = () => {
      wsDisconnectRef.current();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      wsDisconnectRef.current(); // Cleanup on true unmount only
    };
  }, []); // Empty deps — runs once on mount, cleanup on unmount

  const toggleHold = useCallback(() => {
    heldRef.current = !heldRef.current;
    setHeld(heldRef.current);
  }, []);

  // ── Start ──
  const start = useCallback(async () => {
    // Reset all modules
    setError(null); setHeld(false); setProfilerState(null);
    heldRef.current = false; isStreamingRef.current = true;
    profilerStateRef.current = null;
    copilot.resetAll();
    gate.reset();
    transcript.resetAll();

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

      // 3. Connect WebSocket
      setStatus('connecting');
      const wsInstance = await ws.connect(tokenData.token);

      // 4. Start audio pipeline
      const pipeline = createAudioPipeline({ micStream, systemAudioStream, ws: wsInstance });
      audioPipelineRef.current = pipeline;

      // 5. Start session tracking
      setIsStreaming(true);
      transcript.startSession();

      // 6. Start profiler if enabled
      if (capabilitiesRef.current.profiler) {
        const profilerInst = createProfilerLoop({
          intervalMs: 60000,
          getTaggedTranscripts: () => transcript.taggedTranscriptsRef.current,
          getLastTick: () => profilerStateRef.current?._lastTick || 0,
          setLastTick: (n) => { if (profilerStateRef.current) profilerStateRef.current._lastTick = n; },
          getState: () => profilerStateRef.current,
          onUpdate: (newState) => {
            profilerStateRef.current = newState;
            setProfilerState(newState);
          },
        });
        profilerLoopRef.current = profilerInst;
        profilerInst.start();
        console.log('[profiler] Started');
      }
    } catch (err) {
      setError(err.message);
      stopInternal();
    }
  }, [ws, copilot, gate, transcript]);

  // ── Stop ──
  const stopInternal = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);

    // Stop profiler
    if (profilerLoopRef.current) { profilerLoopRef.current.stop(); profilerLoopRef.current = null; }

    // Disconnect WS
    ws.disconnect();

    // Cleanup audio
    if (audioPipelineRef.current) { audioPipelineRef.current.cleanup(); audioPipelineRef.current = null; }
    stopMediaStream(mediaStreamRef.current); mediaStreamRef.current = null;
    stopMediaStream(displayStreamRef.current); displayStreamRef.current = null;

    // Reset modules
    gate.reset();
    transcript.stopSession();
  }, [ws, gate, transcript]);

  // Wire up the forward ref so handleMessage callbacks can reach stopInternal
  stopRef.current = stopInternal;

  const stop = useCallback(() => { stopInternal(); setStatus('idle'); }, [stopInternal]);

  // BS2: Burn It — flush active context
  const flushActiveContext = useCallback(() => {
    copilot.flushActiveContext();
    gate.reset();
    transcript.setPartialText('');
  }, [copilot, gate, transcript]);

  // ── Merge status: copilot status takes priority when active ──
  const mergedStatus = copilot.copilotStatus === 'thinking' || copilot.copilotStatus === 'streaming'
    ? copilot.copilotStatus
    : status;

  return {
    isStreaming,
    transcripts: transcript.transcripts,
    partialText: gate.previewText || transcript.partialText,
    bullets: copilot.bullets,
    rawResponse: copilot.rawResponse,
    copilotLatency: copilot.copilotLatency,
    bulletHistory: copilot.bulletHistory,
    metrics: transcript.metrics,
    status: mergedStatus,
    error,
    held,
    speakingStartRef: transcript.speakingStartRef,
    profilerState,
    activeQuestion: copilot.activeQuestion,
    start, stop, toggleHold, flushActiveContext,
  };
}
