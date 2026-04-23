/**
 * Stealth Copilot — State Orchestrator
 * 
 * This is the ONLY place where global state lives.
 * Connects useTranscription hook → child components.
 * No render logic, no parsing, no complex markup.
 * 
 * Re-render isolation:
 *   - HistoricalThread: React.memo, frozen during streams
 *   - ActiveTurn: hot receiver, re-renders freely during stream
 *   - RamblingBanner: isolated timer via ref (no state in this file)
 * 
 * Capability Control:
 *   - capabilities state object controls all toggleable features
 *   - RF1: keyterms toggle disabled while streaming (evaluated on next Start only)
 *   - RF2: No Hold Gate — merged into autoCopilot
 *   - RF3: clipboard poller uses document.hasFocus() guard
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranscription } from '@/lib/useTranscription';

import CoverPage from './components/CoverPage';
import RamblingBanner from './components/RamblingBanner';
import StatusBar from './components/StatusBar';
import ControlBar from './components/ControlBar';
import CapabilityPanel from './components/CapabilityPanel';
import SessionSetup from './components/SessionSetup';
import HistoricalThread from './components/HistoricalThread';
import ActiveTurn from './components/ActiveTurn';
import FollowUpPanel from './components/FollowUpPanel';

export default function CopilotPage() {
  // ── Capability state (centralized) ──
  const [capabilities, setCapabilities] = useState({
    terminalMode: false,      // Manual Terminal Mode override
    clipboardCapture: true,   // Clipboard Poller active
    autoStealth: true,        // Auto cover on blur
    keyterms: true,           // Keyterms injection in STT
    profiler: true,           // Background profiler loop
    autoCopilot: true,        // Auto-fire copilot on end_of_turn
  });
  const [modesOpen, setModesOpen] = useState(false);
  const [sessionContext, setSessionContext] = useState(null);

  const toggleCapability = useCallback((key) => {
    setCapabilities(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const {
    isStreaming, transcripts, partialText, rawResponse,
    copilotLatency, bulletHistory, metrics, status, error,
    held, speakingStartRef, profilerState, activeQuestion,
    start, stop, toggleHold, flushActiveContext, triggerRescue,
  } = useTranscription(capabilities, sessionContext);

  const [mode, setMode] = useState('copilot');
  const [followUp, setFollowUp] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const threadRef = useRef(null);

  // ── Auto-scroll when history or active response updates ──
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [bulletHistory, rawResponse, status]);

  // ── Keyboard: ESC=cover, Space=hold, Ctrl+Shift+S=autoStealth ──
  // Keyboard shortcuts:
  // ESC = toggle cover mode
  // Spacebar = SOS Rescue (handled in useTranscription.js, NOT here)
  // Ctrl+Shift+S = toggle auto-stealth
  // Backspace/Delete = flush active context ("Burn It")
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') setMode((m) => m === 'copilot' ? 'cover' : 'copilot');
    // NOTE: Spacebar is reserved for SOS Rescue in useTranscription.js
    // Do NOT handle it here — it causes a conflict
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') {
      e.preventDefault();
      toggleCapability('autoStealth');
    }
    // BS2: Backspace/Delete = "Burn It" — flush active context
    if ((e.code === 'Backspace' || e.code === 'Delete') && e.target === document.body) {
      e.preventDefault();
      flushActiveContext();
    }
  }, [toggleCapability, flushActiveContext]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Auto-stealth: blur/focus/visibility ──
  useEffect(() => {
    if (!capabilities.autoStealth) return;
    const handleBlur = () => setMode('cover');
    const handleFocus = () => setMode('copilot');
    const handleVis = () => setMode(document.hidden ? 'cover' : 'copilot');
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVis);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, [capabilities.autoStealth]);

  useEffect(() => { document.title = mode === 'cover' ? 'Meeting Notes' : 'Notes'; }, [mode]);

  // ── Follow-up generator (SSE stream) ──
  const generateFollowUp = useCallback(async () => {
    setFollowUpLoading(true);
    setFollowUp('');
    try {
      const history = bulletHistory.map(h => ({
        question: h.question, bullets: h.bullets, rawResponse: h.rawResponse,
      }));
      const res = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, profilerState }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '', buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.done) break;
            if (event.error) throw new Error(event.error);
            if (event.token) { fullText += event.token; setFollowUp(fullText); }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (e) {
      setFollowUp(`⚠ Error generating follow-up: ${e.message}`);
    } finally {
      setFollowUpLoading(false);
    }
  }, [bulletHistory, profilerState]);

  const copyFollowUp = useCallback(() => {
    navigator.clipboard.writeText(followUp).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = followUp;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }, [followUp]);

  // ── Stealth cover mode ──
  if (mode === 'cover') return <CoverPage />;

  // Use activeQuestion (the FULL accumulated text sent to copilot) when streaming,
  // fall back to last transcript for display between turns
  const latestQuestion = activeQuestion || (transcripts.length > 0 ? transcripts[transcripts.length - 1].text : null);
  const isActivelyStreaming = status === 'thinking' || status === 'streaming';

  return (
    <div className="copilot-root">
      <RamblingBanner speakingStartRef={speakingStartRef} />

      <StatusBar
        status={status}
        isStreaming={isStreaming}
        held={held}
        profilerState={profilerState}
        copilotLatency={copilotLatency}
        turnCount={metrics.turnCount}
      />

      <ControlBar
        isStreaming={isStreaming}
        hasHistory={bulletHistory.length > 0}
        followUpLoading={followUpLoading}
        modesOpen={modesOpen}
        onStart={start}
        onStop={stop}
        onRescue={triggerRescue}
        onGenerateFollowUp={generateFollowUp}
        onToggleModes={() => setModesOpen(prev => !prev)}
      />

      <CapabilityPanel
        capabilities={capabilities}
        onToggle={toggleCapability}
        isOpen={modesOpen}
        isStreaming={isStreaming}
      />

      {error && <div className="copilot-error">⚠ {error}</div>}

      {/* ── Session setup (pre-start context injection) ── */}
      <SessionSetup
        onContextReady={setSessionContext}
        isStreaming={isStreaming}
        sessionContext={sessionContext}
      />

      {/* ── Scrollable conversation area ── */}
      <div className="copilot-thread" ref={threadRef}>
        {bulletHistory.length === 0 && !isActivelyStreaming && !partialText && (
          <div className="copilot-empty">
            {isStreaming ? 'Listening... speak or play audio.' : 'Click START, then speak or play audio.'}
            <br /><span className="copilot-empty-sub">HUD will appear as the interview progresses.</span>
          </div>
        )}

        {/* FROZEN during streams — memo'd, only re-renders on history push */}
        <HistoricalThread bulletHistory={bulletHistory} />

        {/* HOT — re-renders 20x/sec during streaming, isolated from history */}
        <ActiveTurn
          question={latestQuestion}
          rawResponse={rawResponse}
          partialText={partialText}
          isActive={isActivelyStreaming}
        />
      </div>

      <FollowUpPanel followUp={followUp} onCopy={copyFollowUp} />
    </div>
  );
}
