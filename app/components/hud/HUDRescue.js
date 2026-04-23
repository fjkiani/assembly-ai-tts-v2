/**
 * HUDRescue — Rescue mode HUD renderer
 *
 * Renders: [RESCUE] → [THE PIVOT]
 * Used when candidate stalls mid-sentence (stall watchdog fires).
 *
 * Props: { parsed } — output of parseHUDSections with phase='rescue'
 */
import styles from './HUDResponse.module.css';

export default function HUDRescue({ parsed }) {
  return (
    <div className={styles.hudRescue}>
      {parsed.rescue && (
        <div className={styles.section}>
          <span className={`${styles.label} ${styles.labelRescue}`}>RESCUE</span>
          <p className={`${styles.text} ${styles.rescueText}`}>{parsed.rescue}</p>
        </div>
      )}
      {parsed.pivot && (
        <div className={styles.section}>
          <span className={styles.label}>THE PIVOT</span>
          <p className={styles.text}>{parsed.pivot}</p>
        </div>
      )}
    </div>
  );
}
