/**
 * HUDResponse — Router component that parses raw LLM output
 * and delegates to the correct HUD renderer.
 *
 * Props: { raw } — raw LLM output string
 *
 * Phase routing:
 *   thinking/waiting → spinner
 *   rescue           → HUDRescue
 *   support          → HUDSupport
 *   override         → HUDOverride
 *   hud              → HUDStandard
 *   plain            → plain text fallback
 */
import { parseHUDSections, parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import HUDStandard from './HUDStandard';
import HUDOverride from './HUDOverride';
import HUDRescue from './HUDRescue';
import HUDSupport from './HUDSupport';
import styles from './HUDResponse.module.css';

export default function HUDResponse({ raw }) {
  const parsed = parseHUDSections(raw);
  if (!parsed) return null;

  // Thinking / waiting
  if (parsed.phase === 'thinking' || parsed.phase === 'waiting') {
    return (
      <div className={styles.thinking}>
        <span className={styles.thinkingDot} />
        {parsed.phase === 'thinking' ? 'reasoning...' : 'generating...'}
      </div>
    );
  }

  // Rescue — stall watchdog fired, candidate frozen mid-sentence
  if (parsed.phase === 'rescue') {
    return <HUDRescue parsed={parsed} />;
  }

  // Support — candidate is actively speaking
  if (parsed.phase === 'support') {
    return <HUDSupport parsed={parsed} />;
  }

  // Override — RED LIGHT, course correct
  if (parsed.phase === 'override') {
    return <HUDOverride parsed={parsed} />;
  }

  // Plain — no sections detected
  if (parsed.phase === 'plain') {
    return (
      <div className={styles.plain}>
        <RenderSegments segments={parseSegments(parsed.text)} />
      </div>
    );
  }

  // Standard 5-section HUD
  return <HUDStandard parsed={parsed} />;
}
