/**
 * HUDResponse — Router component that parses raw LLM output
 * and delegates to HUDStandard, HUDOverride, or plain fallback.
 * 
 * Props: { raw } — raw LLM output string
 */
import { parseHUDSections, parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import HUDStandard from './HUDStandard';
import HUDOverride from './HUDOverride';
import styles from './HUDResponse.module.css';

export default function HUDResponse({ raw }) {
  const parsed = parseHUDSections(raw);
  if (!parsed) return null;

  // Thinking / waiting
  if (parsed.phase === 'thinking' || parsed.phase === 'waiting') {
    return (
      <div className={styles.thinkingIndicator}>
        <span className={styles.thinkDot} />
        {parsed.phase === 'thinking' ? 'reasoning...' : 'generating...'}
      </div>
    );
  }

  // Override — RED LIGHT
  if (parsed.phase === 'override') {
    return <HUDOverride parsed={parsed} />;
  }

  // Plain — no sections detected
  if (parsed.phase === 'plain') {
    return <RenderSegments segments={parseSegments(parsed.text)} />;
  }

  // Standard 5-section HUD
  return <HUDStandard parsed={parsed} />;
}
