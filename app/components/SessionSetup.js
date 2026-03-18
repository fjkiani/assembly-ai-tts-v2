/**
 * SessionSetup — Pre-start context input for dynamic keyterms & prompt generation
 * 
 * Appears before the session starts. User pastes a job description or company context.
 * On "Generate", calls /api/generate-context to produce:
 *   - keyterms for AssemblyAI STT boosting
 *   - contextual prompt for turn detection
 * 
 * Props: {
 *   onContextReady: ({ keyterms: string[], prompt: string }) => void,
 *   isStreaming: boolean,
 *   sessionContext: { keyterms: string[], prompt: string } | null
 * }
 */
'use client';
import { useState } from 'react';
import styles from './SessionSetup.module.css';

export default function SessionSetup({ onContextReady, isStreaming, sessionContext }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: input }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onContextReady({
        keyterms: data.keyterms || [],
        prompt: data.prompt || 'Technical job interview between two speakers.',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (isStreaming) return null;

  return (
    <div className={styles.setup}>
      <div className={styles.header}>
        <span className={styles.icon}>🎯</span>
        <span className={styles.title}>Session Context</span>
        {sessionContext && <span className={styles.ready}>✓ {sessionContext.keyterms.length} keyterms loaded</span>}
      </div>

      {!sessionContext ? (
        <>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste job description, company info, or interview context here. An LLM will generate domain-specific keyterms to boost speech recognition accuracy."
            rows={4}
          />
          <div className={styles.actions}>
            <button
              className={styles.generateBtn}
              onClick={handleGenerate}
              disabled={loading || !input.trim()}
            >
              {loading ? 'Generating...' : '⚡ Generate Keyterms'}
            </button>
            <button
              className={styles.skipBtn}
              onClick={() => onContextReady(null)}
            >
              Skip
            </button>
          </div>
          {error && <div className={styles.error}>⚠ {error}</div>}
        </>
      ) : (
        <div className={styles.preview}>
          <div className={styles.promptPreview}>
            <span className={styles.previewLabel}>Prompt:</span> {sessionContext.prompt}
          </div>
          <div className={styles.keytermsPreview}>
            {sessionContext.keyterms.slice(0, 12).map((t, i) => (
              <span key={i} className={styles.tag}>{t}</span>
            ))}
            {sessionContext.keyterms.length > 12 && (
              <span className={styles.more}>+{sessionContext.keyterms.length - 12} more</span>
            )}
          </div>
          <button className={styles.resetBtn} onClick={() => onContextReady(null)}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
