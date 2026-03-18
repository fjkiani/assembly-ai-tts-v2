/**
 * HUDOverride — RED LIGHT override renderer
 * 
 * Renders: [COURSE CORRECT] → [THE PIVOT MOVE] → [THE DIAGNOSTIC]
 * Fires when Alpha is off-script or rambling.
 * 
 * Props: { parsed } — output of parseHUDSections with phase='override'
 */
import { parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import styles from './HUDResponse.module.css';

export default function HUDOverride({ parsed }) {
  return (
    <div className={`${styles.container} ${styles.override}`}>
      {parsed.courseCorrect && (
        <div className={styles.courseCorrect}>
          <span className={`${styles.label} ${styles.ccLabel}`}>🔴 COURSE CORRECT</span>
          <div className={styles.ccText}>{parsed.courseCorrect}</div>
        </div>
      )}
      {parsed.pivotMove && (
        <div className={styles.pivotMove}>
          <span className={`${styles.label} ${styles.moveLabel}`}>PIVOT</span>
          <RenderSegments segments={parseSegments(parsed.pivotMove)} className={styles.moveContent} />
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
