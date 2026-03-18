/**
 * HUDStandard — Standard HUD renderer (no BAIT)
 * 
 * Renders: [MOTIVE] → [DELIVERY] → [THE MOVE] → [THE DIAGNOSTIC]
 * 
 * Props: { parsed } — output of parseHUDSections with phase='hud'
 */
import { parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import styles from './HUDResponse.module.css';

export default function HUDStandard({ parsed }) {
  return (
    <div className={styles.container}>
      {parsed.motive && (
        <div className={styles.motive}>
          <span className={`${styles.label} ${styles.motiveLabel}`}>MOTIVE</span>
          <span className={styles.motiveText}>{parsed.motive}</span>
        </div>
      )}
      {parsed.delivery && (
        <div className={styles.delivery}>
          <span className={`${styles.label} ${styles.deliveryLabel}`}>DELIVERY</span>
          <span className={styles.deliveryText}>{parsed.delivery}</span>
        </div>
      )}
      {parsed.move && (
        <div className={styles.move}>
          <span className={`${styles.label} ${styles.moveLabel}`}>THE MOVE</span>
          <RenderSegments segments={parseSegments(parsed.move)} className={styles.moveContent} />
        </div>
      )}
      {parsed.diagnostic && (
        <div className={styles.diagnostic}>
          <span className={`${styles.label} ${styles.diagLabel}`}>DIAGNOSTIC</span>
          <RenderSegments segments={parseSegments(parsed.diagnostic)} className={styles.diagContent} />
        </div>
      )}
    </div>
  );
}
