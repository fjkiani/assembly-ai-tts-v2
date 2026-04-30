/**
 * ControlBar — Session START/STOP + Follow-Up + Modes toggle
 * 
 * Props: { isStreaming, isPaused, hasHistory, followUpLoading, modesOpen, onStart, onStop, onPause, onResume, onRescue, onGenerateFollowUp, onToggleModes }
 */
import styles from './ControlBar.module.css';

export default function ControlBar({
  isStreaming,
  isPaused,
  hasHistory,
  followUpLoading,
  modesOpen,
  onStart,
  onStop,
  onPause,
  onResume,
  onRescue,
  onGenerateFollowUp,
  onToggleModes,
}) {
  return (
    <div className={styles.bar}>
      {!isStreaming && !isPaused ? (
        <button className={`${styles.btn} ${styles.start}`} onClick={onStart}>● START</button>
      ) : isPaused ? (
        <button className={`${styles.btn} ${styles.start}`} onClick={onResume}>▶ RESUME</button>
      ) : (
        <>
          <button className={`${styles.btn} ${styles.rescue}`} onClick={onRescue}>🚨 RESCUE</button>
          <button className={`${styles.btn} ${styles.pause}`} onClick={onPause}>⏸ PAUSE</button>
          <button className={`${styles.btn} ${styles.stop}`} onClick={onStop}>■ STOP</button>
        </>
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
