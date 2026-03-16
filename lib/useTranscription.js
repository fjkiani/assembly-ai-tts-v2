/**
 * useTranscription — Custom React hook
 * 
 * Handles the full browser-native voice pipeline:
 *   1. Opens mic via getUserMedia
 *   2. Fetches a temporary AssemblyAI token from /api/token
 *   3. Opens WebSocket to wss://streaming.assemblyai.com/v3/ws
 *   4. Streams 16kHz mono PCM audio frames
 *   5. Parses Begin/Turn/Termination events
 *   6. Triggers /api/translate on end_of_turn
 *   7. Optionally speaks translations via browser SpeechSynthesis
 */
'use client';

import { useState, useRef, useCallback } from 'react';
import { DOMAIN_KEYTERMS } from './constants';

export function useTranscription({ speakFn } = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [partialText, setPartialText] = useState('');
  const [metrics, setMetrics] = useState({
    avgLatency: 0,
    detectedLanguages: [],
    turnCount: 0,
    sessionDuration: 0,
  });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const turnStartRef = useRef(null);
  const latenciesRef = useRef([]);
  const languagesRef = useRef(new Set());
  const turnCountRef = useRef(0);
  const sessionStartRef = useRef(null);
  const sessionIntervalRef = useRef(null);
  const isStreamingRef = useRef(false);

  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      detectedLanguages: Array.from(languagesRef.current).sort(),
      turnCount: turnCountRef.current,
      sessionDuration: sessionStartRef.current
        ? Math.round((Date.now() - sessionStartRef.current) / 1000)
        : 0,
    });
  }, []);

  const speakText = useCallback((text) => {
    if (!text) return;
    // Strip the [EN]/[ES] prefix for speech
    const cleanText = text.replace(/^\[[A-Z]{2}\]\s*/, '');
    // Use injected ElevenLabs speak, fall back to browser SpeechSynthesis
    if (speakFn) {
      speakFn(cleanText).catch((err) => console.warn('TTS error:', err));
    } else if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const lang = text.startsWith('[ES]') ? 'es-ES' : 'en-US';
      utterance.lang = lang;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }, [speakFn]);

  const start = useCallback(async (useKeyterms = true) => {
    setError(null);
    setTranscripts([]);
    setPartialText('');
    latenciesRef.current = [];
    languagesRef.current = new Set();
    turnCountRef.current = 0;
    turnStartRef.current = null;
    isStreamingRef.current = true;

    try {
      // 1. Get microphone access
      setStatus('Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // 2. Get temporary auth token
      setStatus('Getting auth token...');
      const tokenRes = await fetch('/api/token', { method: 'POST' });
      const tokenData = await tokenRes.json();
      console.log('[iTranslate] Token response:', tokenRes.status, tokenData);
      if (!tokenRes.ok || !tokenData.token) {
        throw new Error(tokenData.error || 'Failed to get auth token');
      }

      // 3. Open WebSocket — v3 uses URL query params for configuration
      setStatus('Connecting to AssemblyAI...');
      const wsParams = new URLSearchParams({
        token: tokenData.token,
        sample_rate: '16000',
        speech_model: 'u3-rt-pro',
      });
      const ws = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[iTranslate] WebSocket connected');
        setStatus('Listening...');
        setIsStreaming(true);

        // Start session timer
        sessionStartRef.current = Date.now();
        sessionIntervalRef.current = setInterval(() => {
          updateMetrics();
        }, 1000);
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('[iTranslate] WS message:', msg.type, msg);

          if (msg.type === 'Begin') {
            setStatus(`Session started: ${msg.id}`);
          } else if (msg.type === 'Turn') {
            const transcript = msg.transcript || '';
            const lang = msg.language_code || 'UNKNOWN';
            const endOfTurn = msg.end_of_turn || false;

            if (!turnStartRef.current && transcript.trim()) {
              turnStartRef.current = Date.now();
            }

            if (endOfTurn && transcript.trim()) {
              console.log('[iTranslate] End of turn:', transcript, 'lang:', lang);
              const latencyMs = turnStartRef.current
                ? Date.now() - turnStartRef.current
                : 0;

              // Language tracking
              if (lang && lang !== 'UNKNOWN') {
                languagesRef.current.add(lang.toUpperCase());
              }

              turnCountRef.current += 1;
              latenciesRef.current.push(latencyMs);
              turnStartRef.current = null;

              // Add STT line
              const sttEntry = {
                text: transcript,
                stage: 'STT',
                lang: lang.toUpperCase(),
                latency: latencyMs,
                id: Date.now(),
              };
              setTranscripts((prev) => [...prev, sttEntry]);
              setPartialText('');
              updateMetrics();

              // Trigger LLM translation
              if (isStreamingRef.current) {
                try {
                  console.log('[iTranslate] Calling /api/translate...');
                  const translateRes = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: transcript, languageCode: lang }),
                  });
                  const translateData = await translateRes.json();
                  console.log('[iTranslate] Translation result:', translateData);
                  const llmEntry = {
                    text: translateData.translation || transcript,
                    stage: 'LLM',
                    lang: translateData.targetLang || 'EN',
                    latency: latencyMs,
                    id: Date.now() + 1,
                  };
                  setTranscripts((prev) => [...prev, llmEntry]);

                  // TTS — speak the translation
                  speakText(translateData.translation);

                  const ttsEntry = {
                    text: 'Audio synthesized and played',
                    stage: 'TTS',
                    lang: '',
                    latency: 0,
                    id: Date.now() + 2,
                  };
                  setTranscripts((prev) => [...prev, ttsEntry]);
                } catch (translateErr) {
                  console.error('[iTranslate] Translation error:', translateErr);
                }
              }
            } else if (!endOfTurn && transcript.trim()) {
              setPartialText(transcript);
            }
          } else if (msg.type === 'Termination') {
            console.log('[iTranslate] Termination:', msg);
            setStatus(
              `Session ended: ${msg.audio_duration_seconds?.toFixed(1) || '?'}s processed`
            );
            stopInternal();
          } else if (msg.type === 'Error') {
            console.error('[iTranslate] Error message:', msg);
            setError(msg.error || 'Unknown streaming error');
            stopInternal();
          }
        } catch (parseErr) {
          console.error('[iTranslate] WebSocket message parse error:', parseErr);
        }
      };

      ws.onerror = (e) => {
        console.error('[iTranslate] WebSocket error:', e);
        setError('WebSocket connection error');
        stopInternal();
      };

      ws.onclose = (e) => {
        console.log('[iTranslate] WebSocket closed:', e.code, e.reason);
        if (isStreamingRef.current) {
          setStatus('Connection closed');
          stopInternal();
        }
      };

      // 4. Set up audio processing — downsample to 16kHz PCM s16le
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      // Use ScriptProcessorNode (wider browser support)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      let audioFrameCount = 0;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 [-1,1] to Int16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm16.buffer);
        audioFrameCount++;
        if (audioFrameCount % 50 === 1) {
          console.log(`[iTranslate] Sent audio frame #${audioFrameCount}, size: ${pcm16.buffer.byteLength} bytes`);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error('Start error:', err);
      setError(err.message);
      stopInternal();
    }
  }, [updateMetrics, speakText]);

  const stopInternal = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);

    if (sessionIntervalRef.current) {
      clearInterval(sessionIntervalRef.current);
      sessionIntervalRef.current = null;
    }

    try {
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'Terminate' }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
    } catch (e) { /* ignore */ }

    try {
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    } catch (e) { /* ignore */ }

    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    } catch (e) { /* ignore */ }

    // Cancel any pending speech
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    updateMetrics();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateMetrics]);

  const stop = useCallback(() => {
    setStatus('Stopping...');
    stopInternal();
    setStatus('idle');
  }, [stopInternal]);

  return {
    isStreaming,
    transcripts,
    partialText,
    metrics,
    status,
    error,
    start,
    stop,
  };
}
