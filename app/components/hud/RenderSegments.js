/**
 * RenderSegments — Renders parsed segments (bullets + code blocks)
 * 
 * Pure display component. No state.
 * Used by HUDStandard, HUDOverride, and ActiveTurn.
 */
import { memo } from 'react';
import styles from './RenderSegments.module.css';

function RenderSegmentsInner({ segments, className }) {
  if (!segments || segments.length === 0) return null;

  return (
    <div className={className || ''}>
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <pre key={i} className={styles.codeBlock}>
              {seg.lang && <span className={styles.codeLang}>{seg.lang}</span>}
              <code>{seg.content}</code>
            </pre>
          );
        }
        return seg.content.map((line, j) => (
          <div key={`${i}-${j}`} className={styles.bullet}>
            <span className={styles.marker}>•</span>
            <span className={styles.text}>{line}</span>
          </div>
        ));
      })}
    </div>
  );
}

const RenderSegments = memo(RenderSegmentsInner);
export default RenderSegments;
