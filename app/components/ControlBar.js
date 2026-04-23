/**
 * ControlBar — Session START/STOP + Rescue + Follow-Up + Modes toggle
 *
 * Props: { isStreaming, hasHistory, followUpLoading, modesOpen,
 *          onStart, onStop, onRescue, onGenerateFollowUp, onToggleModes }
 */
import styles from './ControlBar.module.css';

export default function ControlBar({ isStreaming, hasHistory, followUpLoading, modesOpen, onStart, onStop, onRescue, onGenerateFollowUp, onToggleModes }) {
  return (
    <div className={styles.bar}>
      {!isStreaming ? (
        <button className={`${styles.btn} ${styles.start}`} onClick={onStart}>● START</button>
      ) : (
        <button className={`${styles.btn} ${styles.stop}`} onClick={onStop}>■ STOP</button>
      )}

      {/* Rescue button — only visible while a session is active */}
      {isStreaming && (
        <button
          className={`${styles.btn} ${styles.rescue}`}
          onClick={onRescue}
          title="Instantly fire copilot in rescue mode (also: Spacebar)"
        >
          🆘 RESCUE
        </button>
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
