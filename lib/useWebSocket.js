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
      speaker_labels: 'true',
      max_speakers: '2',
      prompt: wsPrompt,
    });

    if (capabilitiesRef.current.keyterms) {
      const dynamicTerms = sessionContextRef.current?.keyterms || [];
      const allTerms = [...new Set([...dynamicTerms, ...DOMAIN_KEYTERMS])];
      if (allTerms.length > 0) {
        wsParams.append('keyterms_prompt', JSON.stringify(allTerms));
      }
    }
    return wsParams;
  }, [capabilitiesRef, sessionContextRef]);

  const sendConfigure = (wsInstance) => {
    wsInstance.send(JSON.stringify({ type: 'UpdateConfiguration', max_turn_silence: 6000, min_turn_silence: 100 }));
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
          resolve(ws);
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
          onStatusChange('disconnected');

          const NON_RECOVERABLE = [1008, 3006, 4001, 4002];
          if (NON_RECOVERABLE.includes(code)) {
            onStatusChange('error');
            return;
          }

          const attempt = reconnectAttemptsRef.current;
          if (attempt < MAX_RECONNECT) {
            const delayMs = Math.pow(2, attempt) * 1000;
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
                  if (audioPipelineRef.current) audioPipelineRef.current.updateWs(newWs);
                };
                newWs.onmessage = ws.onmessage;
                newWs.onerror = ws.onerror;
                newWs.onclose = ws.onclose;
              } catch (reconnErr) {
                onStatusChange('error');
              }
            }, delayMs);
          } else {
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

  const forceEndpoint = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ForceEndpoint' }));
    }
  }, []);

  const updateConfiguration = useCallback((patch) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'UpdateConfiguration', ...patch }));
    }
  }, []);

  return { wsRef, connect, disconnect, forceEndpoint, updateConfiguration };
}
