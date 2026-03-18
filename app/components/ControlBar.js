/**
 * ControlBar — Session START/STOP + Follow-Up + Modes toggle
 * 
 * Props: { isStreaming, hasHistory, followUpLoading, modesOpen, onStart, onStop, onGenerateFollowUp, onToggleModes }
 */
import styles from './ControlBar.module.css';

export default function ControlBar({ isStreaming, hasHistory, followUpLoading, modesOpen, onStart, onStop, onGenerateFollowUp, onToggleModes }) {
  return (
    <div className={styles.bar}>
      {!isStreaming ? (
        <button className={`${styles.btn} ${styles.start}`} onClick={onStart}>● START</button>
      ) : (
        <button className={`${styles.btn} ${styles.stop}`} onClick={onStop}>■ STOP</button>
      )}
      {hasHistory && (
        <button
          className={`${styles.btn} ${styles.followup}`}
          onClick={onGenerateFollowUp}
          disabled={followUpLoading}
        >
          {followUpLoading ? '⏳ Generating...' : '📋 Follow-Up'}
        </button>
      )}
      <button
        className={`${styles.btn} ${styles.modes} ${modesOpen ? styles.modesOpen : ''}`}
        onClick={onToggleModes}
      >
        ⚙ Modes {modesOpen ? '▴' : '▾'}
      </button>
    </div>
  );
}
