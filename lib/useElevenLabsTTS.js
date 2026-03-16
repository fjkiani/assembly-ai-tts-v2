"use client";

import { useState, useRef, useCallback } from "react";

/**
 * useElevenLabsTTS — React hook for browser-side ElevenLabs audio playback
 * ========================================================================
 * Sends translated text to /api/tts, receives an MP3 stream, and plays it
 * through the browser's native Audio API (works everywhere, including iOS Safari).
 *
 * Usage:
 *   const { speak, stop, isSpeaking } = useElevenLabsTTS();
 *   await speak("Hola, ¿cómo estás?");
 */
export function useElevenLabsTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  /**
   * Synthesise and play text via ElevenLabs.
   * Resolves when audio finishes playing (or rejects on error).
   *
   * @param {string} text        — Text to synthesise
   * @param {string} [voiceId]   — Optional ElevenLabs voice ID override
   * @returns {Promise<void>}
   */
  const speak = useCallback(
    async (text, voiceId) => {
      if (!text || text.trim().length === 0) return;

      // Stop any currently playing audio first
      cleanup();
      setError(null);
      setIsSpeaking(true);

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceId }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `TTS request failed (${res.status})`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        return new Promise((resolve, reject) => {
          const audio = new Audio(url);
          audioRef.current = audio;

          audio.onended = () => {
            setIsSpeaking(false);
            cleanup();
            resolve();
          };

          audio.onerror = (e) => {
            const msg = `Audio playback error: ${e?.message || "unknown"}`;
            setError(msg);
            setIsSpeaking(false);
            cleanup();
            reject(new Error(msg));
          };

          audio.play().catch((playErr) => {
            // Browser autoplay policy may block first play without user gesture
            const msg = `Autoplay blocked: ${playErr.message}. Click anywhere first.`;
            setError(msg);
            setIsSpeaking(false);
            cleanup();
            reject(new Error(msg));
          });
        });
      } catch (err) {
        setError(err.message);
        setIsSpeaking(false);
        throw err;
      }
    },
    [cleanup]
  );

  /** Stop any currently playing audio. */
  const stop = useCallback(() => {
    cleanup();
    setIsSpeaking(false);
  }, [cleanup]);

  return { speak, stop, isSpeaking, error };
}
