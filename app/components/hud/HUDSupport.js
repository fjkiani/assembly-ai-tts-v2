/**
 * HUDSupport — Candidate support mode HUD renderer
 *
 * Renders: [ALPHA IS SPEAKING] → [STRENGTHEN] → [WATCH OUT]
 * Used when candidate is actively speaking (candidate channel fires).
 *
 * Props: { parsed } — output of parseHUDSections with phase='support'
 */
import styles from './HUDResponse.module.css';

export default function HUDSupport({ parsed }) {
  return (
    <div className={styles.hudSupport}>
      {parsed.speaking && (
        <div className={styles.section}>
          <span className={styles.label}>ALPHA IS SPEAKING</span>
          <p className={styles.text}>{parsed.speaking}</p>
        </div>
      )}
      {parsed.strengthen && parsed.strengthen.length > 0 && (
        <div className={styles.section}>
          <span className={`${styles.label} ${styles.labelStrengthen}`}>STRENGTHEN</span>
          <ul className={styles.bulletList}>
            {parsed.strengthen.map((bullet, i) => (
              <li key={i} className={styles.bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      )}
      {parsed.watchOut && parsed.watchOut.length > 0 && (
        <div className={styles.section}>
          <span className={`${styles.label} ${styles.labelWatchOut}`}>WATCH OUT</span>
          <ul className={styles.bulletList}>
            {parsed.watchOut.map((bullet, i) => (
              <li key={i} className={styles.bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
