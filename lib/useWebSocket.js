/**
 * useWebSocket — WebSocket connection lifecycle + auto-reconnect
 * 
 * Responsibilities:
 *   - Open WS connection with params (keyterms, speech model, etc.)
 *   - Send Configure message (max_turn_silence) after open
 *   - Attach message handler (dispatch to transcript processor)
 *   - Exponential backoff auto-reconnect (BS1)
 *   - Clean disconnect with Terminate message
 * 
 * No transcript processing, no copilot logic.
 */
'use client';

import { useRef, useCallback } from 'react';
import { DOMAIN_KEYTERMS } from './constants';

const MAX_RECONNECT = 3;

export function useWebSocket({ capabilitiesRef, sessionContextRef, onMessage, onStatusChange, audioPipelineRef }) {
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const isConnectedRef = useRef(false);

  const buildWsParams = useCallback((token) => {
    const wsPrompt = sessionContextRef.current?.prompt || 'Technical job interview between two speakers. Speakers may pause mid-question.';
    const wsParams = new URLSearchParams({
      token,
      sample_rate: '16000',
      speech_model: 'u3-rt-pro',
      language_detection: 'true',
      speaker_labels: 'true',  // Native speaker diarization — returns speaker_label: 'A'|'B' on each Turn
      prompt: wsPrompt,
    });
    console.log('[ws] Speaker diarization ENABLED (native AssemblyAI)');

    // Keyterms: merge dynamic (from LLM) + static (from constants.js), deduped
    if (capabilitiesRef.current.keyterms) {
      const dynamicTerms = sessionContextRef.current?.keyterms || [];
      const allTerms = [...new Set([...dynamicTerms, ...DOMAIN_KEYTERMS])];
      if (allTerms.length > 0) {
        wsParams.append('keyterms_prompt', JSON.stringify(allTerms));
        console.log(`[ws] Keyterms ENABLED: ${allTerms.length} terms (${dynamicTerms.length} dynamic + ${DOMAIN_KEYTERMS.length} static, deduped)`);
      }
    } else {
      console.log('[ws] Keyterms DISABLED');
    }
    return wsParams;
  }, [capabilitiesRef, sessionContextRef]);

  const sendConfigure = (wsInstance) => {
    // max_turn_silence: 6000ms gives Alpha 6 seconds to think before AssemblyAI cuts the turn
    // min_turn_silence: 500ms prevents cutting words that have brief pauses
    wsInstance.send(JSON.stringify({ type: 'UpdateConfiguration', max_turn_silence: 6000, min_turn_silence: 500 }));
    console.log('[ws] Sent UpdateConfiguration: max_turn_silence=6000, min_turn_silence=500');
  };

  const connect = useCallback((token) => {
    return new Promise((resolve, reject) => {
      try {
        const wsParams = buildWsParams(token);
        const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`);
        wsRef.current = ws;

        ws.onopen = () => {
          isConnectedRef.current = true;
          reconnectAttemptsRef.current = 0;
          sendConfigure(ws);
          onStatusChange('listening');
          console.log('[ws] Connected');
          resolve(ws); // Resolve AFTER ws is open and configured
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            onMessage(msg);
          } catch (parseErr) {
            console.error('[ws] parse error:', parseErr);
          }
        };

        ws.onerror = (err) => {
          onStatusChange('error');
          reject(new Error('WebSocket connection error'));
        };

        ws.onclose = (closeEvent) => {
          if (!isConnectedRef.current) return;
          const code = closeEvent?.code || 0;
          const reason = closeEvent?.reason || 'none';
          console.log(`[ws] CLOSED code=${code} reason=${reason}`);
          onStatusChange('disconnected');

          // Don't reconnect on non-recoverable errors (too many sessions, auth failures)
          const NON_RECOVERABLE = [1008, 3006, 4001, 4002];
          if (NON_RECOVERABLE.includes(code)) {
            console.error(`[ws] Non-recoverable close (${code}: ${reason}). Not reconnecting.`);
            onStatusChange('error');
            return;
          }

          // BS1: Exponential Backoff Auto-Reconnect
          const attempt = reconnectAttemptsRef.current;
          if (attempt < MAX_RECONNECT) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`[ws] Reconnect attempt ${attempt + 1}/${MAX_RECONNECT} in ${delayMs}ms...`);
            reconnectAttemptsRef.current = attempt + 1;
            reconnectTimerRef.current = setTimeout(async () => {
              try {
                const tokenRes = await fetch('/api/token', { method: 'POST' });
                const tokenData = await tokenRes.json();
                if (!tokenRes.ok || !tokenData.token) throw new Error('Re-auth failed');

                const reconParams = buildWsParams(tokenData.token);
                const newWs = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${reconParams.toString()}`);
                wsRef.current = newWs;
                newWs.onopen = () => {
                  sendConfigure(newWs);
                  onStatusChange('listening');
                  console.log('[ws] Reconnected successfully!');
                  if (audioPipelineRef.current) audioPipelineRef.current.updateWs(newWs);
                };
                newWs.onmessage = ws.onmessage;
                newWs.onerror = ws.onerror;
                newWs.onclose = ws.onclose;
              } catch (reconnErr) {
                console.error('[ws] Reconnect failed:', reconnErr);
                onStatusChange('error');
              }
            }, delayMs);
          } else {
            console.error('[ws] Max reconnect attempts reached');
            onStatusChange('error');
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }, [buildWsParams, onMessage, onStatusChange, audioPipelineRef]);

  const disconnect = useCallback(() => {
    isConnectedRef.current = false;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    try {
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'Terminate' }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
    } catch {}
  }, []);

  return { wsRef, connect, disconnect };
}
