/**
 * useTranscription — Thin Orchestrator Hook
 *
 * Wires together:
 * - useWebSocket.js (WS connection, reconnect)
 * - useDebounceGate.js (accumulate, word-count gate, flush timer — 3 channels)
 * - useCopilotFire.js (fire copilot, stream, bookend memory)
 * - useTranscriptProcessor.js (Turn messages, speaker tagging, metrics, normalized events)
 * - audioCapture.js (mic + system audio)
 * - profilerLoop.js (60s background profiler)
 *
 * This file owns: start/stop lifecycle, capabilities ref, clipboard poller,
 * stall watchdog (replaces brain-freeze setInterval).
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

  // Stall watchdog — replaces brain-freeze setInterval
  // Driven by SpeechStarted → partial delta → end_of_turn:true
  const stallWatchdogRef = useRef(null);
  const rescueFiredRef = useRef(false); // reset only on end_of_turn:true
  const STALL_TIMEOUT_MS = 4000;

  // Forward refs to break circular dependency:
  // transcript callbacks (onPartial, onSpeechStarted) need watchdog functions,
  // but watchdog functions need transcript.lastPartialRef — resolved after both are initialized.
  // cancelStallWatchdog is also forward-ref'd because handleMessage references it
  // before the useCallback definition (const TDZ would throw on first render).
  const startStallWatchdogRef = useRef(null);
  const resetStallWatchdogRef = useRef(null);
  const cancelStallWatchdogRef = useRef(null);

  // ── Wire up sub-hooks ──

  // 1. Copilot Fire
  const copilot = useCopilotFire({
    capabilitiesRef,
    profilerStateRef,
    clipboardCodeRef,
    speakingStartRef: null, // Updated below after transcript processor is created
  });

  // 2. Debounce Gate — 3 explicit channels, echo detection only on candidate
  const gate = useDebounceGate({
    onFire: copilot.fire,
    capabilitiesRef,
    copilotFiringRef: copilot.copilotFiringRef,
    isStreamingRef,
    lastCopilotOutputRef: copilot.lastCopilotOutputRef,
  });

  // 3. Transcript Processor — normalized events, SpeechStarted, turnLogRef, lastPartialRef
  const transcript = useTranscriptProcessor({
    onFinalTurn: (turnEvent) => {
      // Update topic anchor (first interviewer turn >8 words = active problem)
      copilot.updateTopicAnchor(turnEvent);
      // Route to correct gate channel based on resolved speaker role
      gate.accumulate(turnEvent.transcript, turnEvent.speaker_role);
    },
    onPartial: (turnEvent) => {
      // Reset stall watchdog on every partial delta — candidate is still speaking
      if (turnEvent.speaker_role === 'candidate') {
        resetStallWatchdogRef.current?.();
      }
    },
    onSpeechStarted: (speechEvent) => {
      // Start stall watchdog when candidate starts speaking
      if (speechEvent.role === 'candidate') {
        startStallWatchdogRef.current?.();
      }
    },
    onEndOfTurn: gate.accumulate, // backward compat — remove after full migration
  });

  // Fix circular ref: copilot needs speakingStartRef from transcript processor
  copilot.speakingStartRefBridge.current = transcript.speakingStartRef;

  // 4. WebSocket — message handler dispatches to transcript processor
  const handleMessage = useCallback((msg) => {
    if (msg.type === 'Begin') {
      setStatus('listening');
    } else if (msg.type === 'SpeechStarted') {
      // Delegate to transcript processor — it will call onSpeechStarted callback
      transcript.processMessage(msg);
    } else if (msg.type === 'Turn') {
      // Cancel watchdog on final turn — candidate completed normally
      if (msg.end_of_turn === true) {
        cancelStallWatchdogRef.current?.();
      }
      transcript.processMessage(msg);
    } else if (msg.type === 'Termination') {
      setStatus('ended');
      if (stopRef.current) stopRef.current();
    } else if (msg.type === 'Error') {
      setError(msg.error || 'Streaming error');
      if (stopRef.current) stopRef.current();
    }
  }, [transcript]); // cancelStallWatchdog accessed via cancelStallWatchdogRef — no dep needed

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

  // Wire updateConfiguration into copilot for mid-session keyterm pushes
  copilot.wsUpdateConfigRef.current = ws.updateConfiguration;

  // ── Stall Watchdog ──
  // Replaces the old setInterval brain-freeze loop.
  // Event-driven: SpeechStarted → start → partial → reset → end_of_turn:true → cancel
  const startStallWatchdog = useCallback(() => {
    if (stallWatchdogRef.current) clearTimeout(stallWatchdogRef.current);
    rescueFiredRef.current = false;
    stallWatchdogRef.current = setTimeout(() => {
      if (!isStreamingRef.current) return;
      if (copilot.copilotFiringRef.current) return; // copilot already in-flight
      if (rescueFiredRef.current) return;
      // Fire rescue with the last partial transcript (genuine stall)
      const lastPartial = transcript.lastPartialRef?.current;
      const rescueContext = lastPartial?.transcript || 'Candidate stalled mid-sentence.';
      console.log('[rescue] 🧊 STALL WATCHDOG FIRED — context:', rescueContext.slice(0, 80));
      rescueFiredRef.current = true;
      gate.reset();
      copilot.fire(rescueContext, 'candidate', { rescue: true });
    }, STALL_TIMEOUT_MS);
  }, [copilot, gate, transcript, isStreamingRef]);

  const resetStallWatchdog = useCallback(() => {
    // Candidate is still speaking — got a new partial, restart the watchdog
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
    startStallWatchdog();
  }, [startStallWatchdog]);

  const cancelStallWatchdog = useCallback(() => {
    // Candidate completed normally — cancel watchdog, no rescue needed
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
    rescueFiredRef.current = false;
  }, []);

  // Wire forward refs now that the actual functions are defined
  startStallWatchdogRef.current = startStallWatchdog;
  resetStallWatchdogRef.current = resetStallWatchdog;
  cancelStallWatchdogRef.current = cancelStallWatchdog;

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
  const wsDisconnectRef = useRef(ws.disconnect);
  wsDisconnectRef.current = ws.disconnect;

  useEffect(() => {
    const handleUnload = () => {
      wsDisconnectRef.current();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      wsDisconnectRef.current();
    };
  }, []);

  const toggleHold = useCallback(() => {
    heldRef.current = !heldRef.current;
    setHeld(heldRef.current);
  }, []);

  // ── Start ──
  const start = useCallback(async () => {
    setError(null); setHeld(false); setProfilerState(null);
    heldRef.current = false; isStreamingRef.current = true;
    profilerStateRef.current = null;
    copilot.resetAll();
    gate.reset();
    transcript.resetAll();

    try {
      setStatus('mic');
      const micStream = await captureMic();
      mediaStreamRef.current = micStream;

      const { stream: displayStream, audioStream: systemAudioStream } = await captureSystemAudio();
      if (displayStream) displayStreamRef.current = displayStream;

      setStatus('auth');
      const tokenRes = await fetch('/api/token', { method: 'POST' });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.token) throw new Error(tokenData.error || 'Failed to get auth token');

      setStatus('connecting');
      const wsInstance = await ws.connect(tokenData.token);

      const pipeline = createAudioPipeline({ micStream, systemAudioStream, ws: wsInstance });
      audioPipelineRef.current = pipeline;

      setIsStreaming(true);
      transcript.startSession();

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

    // Cancel stall watchdog
    cancelStallWatchdog();

    if (profilerLoopRef.current) { profilerLoopRef.current.stop(); profilerLoopRef.current = null; }

    ws.disconnect();

    if (audioPipelineRef.current) { audioPipelineRef.current.cleanup(); audioPipelineRef.current = null; }
    stopMediaStream(mediaStreamRef.current); mediaStreamRef.current = null;
    stopMediaStream(displayStreamRef.current); displayStreamRef.current = null;

    gate.reset();
    transcript.stopSession();
  }, [ws, gate, transcript, cancelStallWatchdog]);

  stopRef.current = stopInternal;

  const stop = useCallback(() => { stopInternal(); setStatus('idle'); }, [stopInternal]);

  // BS2: Burn It — flush active context
  const flushActiveContext = useCallback(() => {
    copilot.flushActiveContext();
    gate.reset();
    transcript.setPartialText('');
  }, [copilot, gate, transcript]);

  // ── RESCUE MODE ──
  // triggerRescue: bypass debounce, fire copilot in rescue mode with last partial
  const triggerRescue = useCallback(() => {
    if (!isStreamingRef.current) return;
    if (copilot.copilotFiringRef.current) {
      console.log('[rescue] Copilot already in-flight — skipping rescue.');
      return;
    }
    // Use the last partial transcript from the normalized event log
    const lastPartial = transcript.lastPartialRef?.current;
    const rescueContext = lastPartial?.transcript
      || transcript.transcripts.slice(-3).map(t => t.text).join(' ')
      || 'Candidate stalled mid-sentence.';
    console.log('[rescue] 🚨 RESCUE MODE TRIGGERED — context:', rescueContext.slice(0, 80));
    gate.reset();
    copilot.fire(rescueContext, 'candidate', { rescue: true });
    rescueFiredRef.current = true;
  }, [copilot, gate, transcript, isStreamingRef]);

  // SOS Hotkey: Spacebar fires rescue instantly
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== 'Space') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (!isStreamingRef.current) return;
      e.preventDefault();
      console.log('[rescue] 🆘 SOS HOTKEY (spacebar) — triggering rescue now!');
      triggerRescue();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerRescue]);

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
    start, stop, toggleHold, flushActiveContext, triggerRescue,
  };
}
