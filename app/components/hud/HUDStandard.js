/**
 * HUDStandard — Standard HUD renderer
 *
 * Renders: [MOTIVE] → [DELIVERY] → [THE MOVE] → [THE BAIT]
 *
 * Props: { parsed } — output of parseHUDSections with phase='hud'
 */
import { parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import styles from './HUDResponse.module.css';

export default function HUDStandard({ parsed }) {
  return (
    <div className={styles.hudStandard}>
      {parsed.motive && (
        <div className={styles.section}>
          <span className={styles.label}>MOTIVE</span>
          <p className={styles.text}>{parsed.motive}</p>
        </div>
      )}
      {parsed.delivery && (
        <div className={styles.section}>
          <span className={styles.label}>DELIVERY</span>
          <p className={styles.text}>{parsed.delivery}</p>
        </div>
      )}
      {parsed.move && (
        <div className={styles.section}>
          <span className={styles.label}>THE MOVE</span>
          <RenderSegments segments={parseSegments(parsed.move)} />
        </div>
      )}
      {parsed.bait && (
        <div className={styles.section}>
          <span className={styles.label}>THE BAIT</span>
          <p className={styles.text}>{parsed.bait}</p>
        </div>
      )}
    </div>
  );
}
