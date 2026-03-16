'use client';

import { useState, useCallback, useRef } from 'react';
import { useVideoDubbing } from '@/lib/useVideoDubbing';
import { DOMAIN_KEYTERMS } from '@/lib/constants';

// ─── Transcript Panel ───
function TranscriptPanel({ transcripts, partialText, emptyMessage }) {
  return (
    <div className="transcript-box">
      {transcripts.length === 0 && !partialText ? (
        <div className="transcript-empty">
          <div>
            <div className="transcript-empty-icon">🎬</div>
            <div>{emptyMessage}</div>
          </div>
        </div>
      ) : (
        <>
          {transcripts.slice(-20).map((entry) => (
            <div
              key={entry.id}
              className={`transcript-line ${
                entry.stage === 'LLM' ? 'transcript-line--llm' : ''
              } ${entry.stage === 'TTS' ? 'transcript-line--tts' : ''}`}
            >
              <span
                className={`badge ${
                  entry.stage === 'LLM'
                    ? 'badge--blue'
                    : entry.stage === 'TTS'
                    ? 'badge--purple'
                    : ''
                }`}
              >
                {entry.stage === 'LLM'
                  ? 'LLM Gateway'
                  : entry.stage === 'TTS'
                  ? 'TTS Audio'
                  : 'STT'}
              </span>
              <span className="transcript-text">
                {entry.stage === 'TTS' ? (
                  <em>Synthesized and played to speaker 🔊</em>
                ) : (
                  entry.text
                )}
              </span>
              {entry.stage === 'STT' && entry.lang && (
                <span className="transcript-meta">
                  [Detected: {entry.lang}]
                </span>
              )}
              {entry.stage === 'LLM' && entry.latency > 0 && (
                <span className="transcript-meta">
                  [STT Latency: {entry.latency}ms]
                </span>
              )}
            </div>
          ))}
          {partialText && (
            <div className="transcript-partial">{partialText} ...</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Metrics Sidebar ───
function MetricsSidebar({ metrics, transcripts, isActive }) {
  const sttEntries = transcripts.filter((t) => t.stage === 'STT');
  const llmEntries = transcripts.filter((t) => t.stage === 'LLM' && t.latency > 0);
  const avgLatency =
    llmEntries.length > 0
      ? Math.round(llmEntries.reduce((a, t) => a + t.latency, 0) / llmEntries.length)
      : 0;
  const detectedLangs = [
    ...new Set(sttEntries.map((t) => t.lang).filter((l) => l && l !== 'UNKNOWN')),
  ].sort();

  return (
    <div className="sidebar">
      <h3 className="section-title">📈 Real-Time Metrics</h3>

      <div className="stat-card stat-card--green">
        <div className="stat-value">
          {metrics.avgLatency || avgLatency}<span>ms</span>
        </div>
        <div className="stat-label">Avg STT Latency</div>
      </div>

      <div className="stat-card stat-card--blue">
        <div className="stat-value" style={{ fontSize: '1.2rem' }}>
          {(metrics.detectedLanguages?.length > 0
            ? metrics.detectedLanguages
            : detectedLangs
          ).join(', ') || '—'}
        </div>
        <div className="stat-label">Detected Languages</div>
      </div>

      <div className="stat-card">
        <div className="stat-value">
          {metrics.turnCount || sttEntries.length}
        </div>
        <div className="stat-label">Finalized Turns</div>
      </div>

      <div className="arch-box">
        <h4 className="section-title">☁️ Cloud Parameters</h4>
        <div className="arch-row">
          <span className="arch-label">Compute:</span>
          <span className="arch-value">0% On-Device</span>
        </div>
        <div className="arch-row">
          <span className="arch-label">Model:</span>
          <span className="arch-value"><code>u3-rt-pro</code></span>
        </div>
        <div className="arch-row">
          <span className="arch-label">Audio:</span>
          <span className="arch-value">16kHz PCM</span>
        </div>
        <div className="arch-row">
          <span className="arch-label">Features:</span>
          <span className="arch-value">Code-Switching</span>
        </div>
        <div className="arch-row">
          <span className="arch-label">LLM:</span>
          <span className="arch-value">Cohere Command-A</span>
        </div>
        <div className="arch-row">
          <span className="arch-label">TTS:</span>
          <span className="arch-value">ElevenLabs (Sarah)</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [useKeyterms, setUseKeyterms] = useState(true);

  // ─── Video Dubbing ───
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState('https://www.youtube.com/watch?v=OJxNhMc-xyg');
  const [videoSrc, setVideoSrc] = useState('/videos/demo.mp4');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const {
    isProcessing,
    isSpeaking,
    transcripts,
    partialText,
    metrics,
    status,
    error,
    start: videoStart,
    stop: videoStop,
  } = useVideoDubbing(videoRef);

  const handleDownload = useCallback(async () => {
    if (!videoUrl.trim()) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch('/api/video/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Download failed');
      }
      setVideoSrc(data.path + '?t=' + Date.now());
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setIsDownloading(false);
    }
  }, [videoUrl]);

  const handleVideoStart = () => videoStart(useKeyterms);

  // ─── Analytics ───
  const sttEntries = transcripts.filter((t) => t.stage === 'STT');
  const llmEntries = transcripts.filter((t) => t.stage === 'LLM' && t.latency > 0);
  const avgLatency =
    llmEntries.length > 0
      ? Math.round(llmEntries.reduce((a, t) => a + t.latency, 0) / llmEntries.length)
      : 0;
  const detectedLangs = [
    ...new Set(sttEntries.map((t) => t.lang).filter((l) => l && l !== 'UNKNOWN')),
  ].sort();
  const allSttText = sttEntries.map((t) => t.text).join(' ').toLowerCase();
  const ktHits = DOMAIN_KEYTERMS.filter((kt) => allSttText.includes(kt.toLowerCase()));
  const ktMisses = DOMAIN_KEYTERMS.filter((kt) => !allSttText.includes(kt.toLowerCase()));
  const ktHitRate =
    DOMAIN_KEYTERMS.length > 0
      ? Math.round((ktHits.length / DOMAIN_KEYTERMS.length) * 100)
      : 0;
  const showPostSession = !isProcessing && sttEntries.length > 0;
  const ktPreview = DOMAIN_KEYTERMS.slice(0, 6).join(', ') + '...';

  return (
    <div className="app-container">
      {/* ─── Hero ─── */}
      <h1 className="hero-title">🎙️ iTranslate Demo</h1>
      <p className="hero-subtitle">
        Real-time Video Dubbing powered by AssemblyAI Universal-3 Pro
      </p>

      <div className="badges-row">
        <span className="badge">u3-rt-pro</span>
        <span className="badge">Code-Switching</span>
        <span className="badge">Sub-300ms Latency</span>
        <span className="badge">16kHz PCM</span>
        <span className="badge">6 Languages</span>
        <span className="badge badge--blue">Cohere Translation</span>
        <span className="badge badge--purple">ElevenLabs TTS</span>
        <span className="badge badge--blue">Video Dubbing</span>
      </div>

      {/* ─── Main Grid ─── */}
      <div className="main-grid">
        {/* ─── Left Column ─── */}
        <div>
          {/* Keyterms Toggle */}
          <div className="keyterms-section">
            <div className="keyterms-header">
              🎛️ STT Tuning: Universal-3 Pro Keyterms Prompting
            </div>
            <p className="keyterms-desc">
              Universal-3 Pro supports <strong>Keyterms Prompting</strong> — a word-level
              and turn-level boosting engine that biases the speech model to accurately
              recognize domain-specific vocabulary during live inference. Currently loaded:{' '}
              <strong>{DOMAIN_KEYTERMS.length} keyterms</strong>.
            </p>
            <div className="toggle-row">
              <input
                type="checkbox"
                className="toggle"
                id="keyterms-toggle"
                checked={useKeyterms}
                onChange={(e) => setUseKeyterms(e.target.checked)}
                disabled={isProcessing}
              />
              <label htmlFor="keyterms-toggle" className="toggle-label">
                Boost Domain Terms ({DOMAIN_KEYTERMS.length} keyterms)
              </label>
            </div>
            <p className="toggle-status">
              {useKeyterms
                ? `✅ Keyterms active: ${ktPreview}`
                : '⚪ Baseline mode — no domain term boosting'}
            </p>
          </div>

          {/* Video URL Input */}
          <div className="video-input-section">
            <div className="keyterms-header">🎬 Video Source</div>
            <p className="keyterms-desc">
              Paste a YouTube URL to download and dub in real-time. The video will
              pause at natural speech boundaries, translate, speak the translation,
              then resume.
            </p>
            <div className="video-url-row">
              <input
                type="text"
                className="video-url-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={isDownloading || isProcessing}
              />
              <button
                className="btn btn--primary"
                onClick={handleDownload}
                disabled={isDownloading || !videoUrl.trim() || isProcessing}
              >
                {isDownloading ? '⏳ Downloading...' : '📥 Download'}
              </button>
            </div>
            {downloadError && (
              <div className="error-banner" style={{ marginTop: 8 }}>
                ⚠️ {downloadError}
              </div>
            )}
          </div>

          {/* Video Player */}
          {videoSrc && (
            <div className="video-player-section">
              <video
                ref={videoRef}
                src={videoSrc}
                className="video-player"
                controls
                preload="auto"
              />

              <div className="controls-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--primary"
                  onClick={handleVideoStart}
                  disabled={isProcessing}
                >
                  ▶️ Start Dubbing
                </button>
                <button
                  className="btn btn--stop"
                  onClick={videoStop}
                  disabled={!isProcessing}
                >
                  ⏹ Stop Dubbing
                </button>
                {isSpeaking && (
                  <span className="badge badge--purple" style={{ padding: '8px 14px' }}>
                    🔊 Speaking translation...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Status */}
          <div className="status-bar">
            {isProcessing ? (
              <>
                <span className="pulse-dot" />
                <span className="status-text--active">{status}</span>
              </>
            ) : (
              <span className="status-text--idle">
                {status === 'idle'
                  ? videoSrc
                    ? '⏸ Ready — click Start Dubbing to begin'
                    : '⏸ Download a video first'
                  : status}
              </span>
            )}
          </div>

          {error && <div className="error-banner">⚠️ {error}</div>}

          <h3 className="section-title">📝 Dubbing Transcription</h3>
          <TranscriptPanel
            transcripts={transcripts}
            partialText={partialText}
            emptyMessage={
              <>
                {videoSrc
                  ? <>Click <strong>Start Dubbing</strong> then play the video</>
                  : <>Download a YouTube video to begin dubbing</>
                }
              </>
            }
          />

          {/* ─── Post-Session Analytics ─── */}
          {showPostSession && (
            <div className="analytics-section">
              <div className="analytics-success">
                🏁 Session Complete — Live Analytics Below
              </div>

              <h3 className="section-title">📊 Session Analytics</h3>
              <div className="analytics-grid">
                <div className="stat-card stat-card--green">
                  <div className="stat-value">
                    {avgLatency}<span>ms</span>
                  </div>
                  <div className="stat-label">Avg STT Latency</div>
                </div>
                <div className="stat-card stat-card--blue">
                  <div className="stat-value" style={{ fontSize: '1.2rem' }}>
                    {detectedLangs.length > 0 ? detectedLangs.join(', ') : '—'}
                  </div>
                  <div className="stat-label">Languages</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{sttEntries.length}</div>
                  <div className="stat-label">Finalized Turns</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">
                    {ktHitRate}%{' '}
                    <span>
                      ({ktHits.length}/{DOMAIN_KEYTERMS.length})
                    </span>
                  </div>
                  <div className="stat-label">Keyterms Hit Rate</div>
                </div>
              </div>

              {ktHits.length > 0 && (
                <div className="keyterms-results">
                  <div className="keyterms-results-label keyterms-results-label--hit">
                    Matched:
                  </div>
                  <div className="keyterms-badges">
                    {ktHits.map((kt) => (
                      <span key={kt} className="badge">✓ {kt}</span>
                    ))}
                  </div>
                </div>
              )}
              {ktMisses.length > 0 && (
                <div className="keyterms-results" style={{ marginTop: 8 }}>
                  <div className="keyterms-results-label keyterms-results-label--miss">
                    Missed:
                  </div>
                  <div className="keyterms-badges">
                    {ktMisses.map((kt) => (
                      <span key={kt} className="badge badge--red">✗ {kt}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Right Sidebar ─── */}
        <MetricsSidebar
          metrics={metrics}
          transcripts={transcripts}
          isActive={isProcessing}
        />
      </div>

      {/* ─── Footer ─── */}
      <footer className="footer">
        Built for AssemblyAI Applied AI Engineering Take-Home •{' '}
        <a
          href="https://www.assemblyai.com/docs/streaming/universal-3-pro"
          target="_blank"
          rel="noopener noreferrer"
        >
          U3 Pro Docs
        </a>{' '}
        •{' '}
        <a
          href="https://www.assemblyai.com/docs/getting-started/transcribe-streaming-audio-from-a-microphone/python"
          target="_blank"
          rel="noopener noreferrer"
        >
          Streaming Tutorial
        </a>
      </footer>
    </div>
  );
}
