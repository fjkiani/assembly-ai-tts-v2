/**
 * useVideoDubbing — Orchestration hook for the Video Dubbing Pipeline
 * ====================================================================
 * Captures audio from a <video> element, streams it to AssemblyAI for
 * real-time STT, and on each finalized turn:
 *   1. Pauses the video
 *   2. Translates via Cohere (/api/translate)
 *   3. Speaks the translation via ElevenLabs (/api/tts)
 *   4. Resumes the video when TTS finishes
 *
 * Uses createMediaElementSource() to route video audio through Web Audio API
 * — audio plays through speakers AND gets streamed to AssemblyAI simultaneously.
 */
'use client';

import { useState, useRef, useCallback } from 'react';
import { DOMAIN_KEYTERMS } from './constants';
import { useElevenLabsTTS } from './useElevenLabsTTS';

export function useVideoDubbing(videoRef) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [partialText, setPartialText] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({
    avgLatency: 0,
    detectedLanguages: [],
    turnCount: 0,
  });

  const { speak, stop: stopTTS, isSpeaking } = useElevenLabsTTS();

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorRef = useRef(null);
  const isProcessingRef = useRef(false);
  const turnStartRef = useRef(null);
  const latenciesRef = useRef([]);
  const languagesRef = useRef(new Set());
  const turnCountRef = useRef(0);
  const isDubbingRef = useRef(false); // true while pause→translate→TTS→resume cycle is running

  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      detectedLanguages: Array.from(languagesRef.current).sort(),
      turnCount: turnCountRef.current,
    });
  }, []);

  // ─── The dubbing orchestration cycle ───
  const handleEndOfTurn = useCallback(
    async (transcript, lang, latencyMs) => {
      const video = videoRef?.current;
      if (!video || isDubbingRef.current) return;

      isDubbingRef.current = true;

      try {
        // 1. Pause video + mute
        video.pause();
        const prevVolume = video.volume;
        video.volume = 0;
        setStatus('Translating...');

        // Track STT entry — detect language from text if AssemblyAI doesn't provide it
        let detectedLang = (lang || 'UNKNOWN').toUpperCase();
        if (detectedLang === 'UNKNOWN' && transcript.trim()) {
          // Simple heuristic: Spanish text has ¿ ¡ á é í ó ú ñ
          const hasSpanishChars = /[¿¡áéíóúñüÁÉÍÓÚÑÜ]/.test(transcript);
          const spanishWords = /\b(el|la|los|las|un|una|es|está|por|que|para|con|del|más|muy|como|pero|también|aquí|tiene|puede|favor|buenos|días|gracias|seguro|médico|necesito|compré)\b/i;
          if (hasSpanishChars || spanishWords.test(transcript)) {
            detectedLang = 'ES';
          } else {
            detectedLang = 'EN';
          }
        }
        const sttEntry = {
          text: transcript,
          stage: 'STT',
          lang: detectedLang,
          latency: latencyMs,
          id: Date.now(),
        };
        setTranscripts((prev) => [...prev, sttEntry]);

        // 2. Translate
        let translatedText = transcript;
        let targetLang = 'EN';
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: transcript, languageCode: lang }),
          });
          const data = await res.json();
          translatedText = data.translation || transcript;
          targetLang = data.targetLang || 'EN';
        } catch (translateErr) {
          console.warn('Translation failed, using original:', translateErr);
        }

        const llmEntry = {
          text: translatedText,
          stage: 'LLM',
          lang: targetLang,
          latency: latencyMs,
          id: Date.now() + 1,
        };
        setTranscripts((prev) => [...prev, llmEntry]);

        // 3. Speak translation via ElevenLabs
        setStatus('Speaking translation...');
        const cleanText = translatedText.replace(/^\[[A-Z]{2}\]\s*/, '');
        try {
          await speak(cleanText);
        } catch (ttsErr) {
          console.warn('TTS playback failed:', ttsErr);
        }

        const ttsEntry = {
          text: 'Audio synthesized and played',
          stage: 'TTS',
          lang: '',
          latency: 0,
          id: Date.now() + 2,
        };
        setTranscripts((prev) => [...prev, ttsEntry]);

        // 4. Resume video
        video.volume = prevVolume;
        if (isProcessingRef.current) {
          video.play().catch(() => {});
          setStatus('Listening...');
        }
      } catch (err) {
        console.error('Dubbing cycle error:', err);
      } finally {
        isDubbingRef.current = false;
      }
    },
    [videoRef, speak]
  );

  // ─── Start the dubbing pipeline ───
  const start = useCallback(
    async (useKeyterms = true) => {
      const video = videoRef?.current;
      if (!video) {
        setError('No video element found');
        return;
      }

      setError(null);
      setTranscripts([]);
      setPartialText('');
      latenciesRef.current = [];
      languagesRef.current = new Set();
      turnCountRef.current = 0;
      turnStartRef.current = null;
      isProcessingRef.current = true;

      try {
        // 1. Get temp token
        setStatus('Getting auth token...');
        const tokenRes = await fetch('/api/token', { method: 'POST' });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.token) {
          throw new Error(tokenData.error || 'Failed to get auth token');
        }

        // 2. Set up Web Audio API to capture video audio
        setStatus('Setting up audio capture...');
        // Note: AudioContext sampleRate is IGNORED when using createMediaElementSource
        // — the browser always runs at the system default (44100/48000 Hz).
        // We must downsample manually to 16kHz before sending to AssemblyAI.
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const nativeRate = audioContext.sampleRate; // e.g. 44100 or 48000

        // createMediaElementSource routes audio through the graph
        // — it plays through speakers AND we can process it
        const source = audioContext.createMediaElementSource(video);
        sourceNodeRef.current = source;

        // Connect to destination so audio plays through speakers
        source.connect(audioContext.destination);

        // Also process for PCM extraction
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        source.connect(processor);
        processor.connect(audioContext.destination);

        // 3. Open WebSocket to AssemblyAI — v3 uses URL query params for config
        setStatus('Connecting to AssemblyAI...');
        const wsParams = new URLSearchParams({
          token: tokenData.token,
          sample_rate: '16000',
          speech_model: 'u3-rt-pro',
          language_detection: 'true',
        });
        const ws = new WebSocket(
          `wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`
        );
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[VideoDub] WebSocket connected');
          setStatus('Listening...');
          setIsProcessing(true);

          // Auto-play the video so audio starts flowing
          video.currentTime = 0;
          video.muted = false;
          video.play().catch(() => {
            setStatus('Click the video to start playback');
          });
        };

        // Audio buffer — accumulate PCM and send in ≥100ms chunks
        // At 16kHz 16-bit mono: 100ms = 1600 samples = 3200 bytes
        const MIN_CHUNK_BYTES = 3200;
        let pcmBuffer = new Int16Array(0);
        let audioFrameCount = 0;

        // Send PCM audio frames to AssemblyAI with buffering
        processor.onaudioprocess = (e) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          if (isDubbingRef.current) return; // Don't send audio during TTS playback

          const inputData = e.inputBuffer.getChannelData(0);

          // Downsample from native rate (44100/48000) to 16000 Hz
          const ratio = nativeRate / 16000;
          const targetLen = Math.floor(inputData.length / ratio);
          const pcm16 = new Int16Array(targetLen);
          for (let i = 0; i < targetLen; i++) {
            const srcIdx = Math.floor(i * ratio);
            const s = Math.max(-1, Math.min(1, inputData[srcIdx]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Accumulate into buffer
          const newBuf = new Int16Array(pcmBuffer.length + pcm16.length);
          newBuf.set(pcmBuffer);
          newBuf.set(pcm16, pcmBuffer.length);
          pcmBuffer = newBuf;

          // Flush when we have at least MIN_CHUNK_BYTES worth
          while (pcmBuffer.length * 2 >= MIN_CHUNK_BYTES) {
            const samplesToSend = MIN_CHUNK_BYTES / 2;
            const chunk = pcmBuffer.slice(0, samplesToSend);
            pcmBuffer = pcmBuffer.slice(samplesToSend);
            wsRef.current.send(chunk.buffer);
            audioFrameCount++;
            if (audioFrameCount % 50 === 1) {
              console.log(`[VideoDub] Sent audio chunk #${audioFrameCount}, ${chunk.buffer.byteLength} bytes`);
            }
          }
        };

        // Handle AssemblyAI messages
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            console.log('[VideoDub] WS message:', msg.type, JSON.stringify(msg).slice(0, 200));

            if (msg.type === 'Begin') {
              console.log('[VideoDub] Session started:', msg.id);
              setStatus('Listening...');
            } else if (msg.type === 'Turn') {
              const transcript = msg.transcript || '';
              // v3 API: try multiple field names for language
              const lang = msg.language_code || msg.language || msg.lang || 'UNKNOWN';
              const endOfTurn = msg.end_of_turn || false;

              if (!turnStartRef.current && transcript.trim()) {
                turnStartRef.current = Date.now();
              }

              if (endOfTurn && transcript.trim()) {
                console.log('[VideoDub] End of turn:', transcript);
                const latencyMs = turnStartRef.current
                  ? Date.now() - turnStartRef.current
                  : 0;

                if (lang && lang !== 'UNKNOWN') {
                  languagesRef.current.add(lang.toUpperCase());
                }
                turnCountRef.current += 1;
                latenciesRef.current.push(latencyMs);
                turnStartRef.current = null;
                setPartialText('');
                updateMetrics();

                // Fire the dubbing cycle (async — don't block the WS handler)
                handleEndOfTurn(transcript, lang, latencyMs);
              } else if (!endOfTurn && transcript.trim()) {
                setPartialText(transcript);
              }
            } else if (msg.type === 'Termination') {
              console.log('[VideoDub] Termination:', msg);
              setStatus(`Session ended: ${msg.audio_duration_seconds?.toFixed(1) || '?'}s`);
              stopInternal();
            } else if (msg.type === 'Error') {
              console.error('[VideoDub] Error:', msg);
              setError(msg.error || 'Streaming error');
              stopInternal();
            } else {
              console.log('[VideoDub] Other message:', msg.type);
            }
          } catch (parseErr) {
            console.error('[VideoDub] WS parse error:', parseErr);
          }
        };

        ws.onerror = (e) => {
          console.error('[VideoDub] WebSocket error:', e);
          setError('WebSocket connection error');
          stopInternal();
        };

        ws.onclose = (e) => {
          console.log('[VideoDub] WebSocket closed:', e.code, e.reason);
          if (isProcessingRef.current) {
            setStatus(`Connection closed: ${e.reason || e.code}`);
          }
        };

        // Listen for video end
        const onVideoEnd = () => {
          setStatus('Video finished');
          // Give time for any final turn to process
          setTimeout(() => {
            if (!isDubbingRef.current) {
              stopInternal();
            }
          }, 3000);
        };
        video.addEventListener('ended', onVideoEnd);

      } catch (err) {
        setError(err.message);
        setIsProcessing(false);
      }
    },
    [videoRef, updateMetrics, handleEndOfTurn]
  );

  const stopInternal = useCallback(() => {
    isProcessingRef.current = false;
    setIsProcessing(false);

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
      // Note: we do NOT close sourceNodeRef or audioContext
      // because that would kill the video's audio permanently.
      // We just disconnect the processor.
    } catch (e) { /* ignore */ }

    stopTTS();
    updateMetrics();
    setStatus('idle');
  }, [stopTTS, updateMetrics]);

  const stop = useCallback(() => {
    const video = videoRef?.current;
    if (video) {
      video.pause();
    }
    stopInternal();
  }, [videoRef, stopInternal]);

  return {
    isProcessing,
    isSpeaking,
    transcripts,
    partialText,
    metrics,
    status,
    error,
    start,
    stop,
  };
}
