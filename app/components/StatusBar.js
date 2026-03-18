/**
 * StatusBar — Top status strip with profiler telemetry
 * 
 * Props: { status, isStreaming, held, profilerState, copilotLatency, turnCount }
 * 
 * Displays: pulse, connection state, power dynamic badge,
 * pillar tracker, latency, turn count, keyboard hints.
 */
import styles from './StatusBar.module.css';

const STATUS_LABELS = {
  idle: '', mic: 'Requesting mic...', auth: 'Authenticating...',
  connecting: 'Connecting...', listening: '', thinking: '', streaming: '',
  ended: 'Session ended', disconnected: 'Disconnected',
};

export default function StatusBar({ status, isStreaming, held, profilerState, copilotLatency, turnCount }) {
  const statusLabel = STATUS_LABELS[status] || '';
  const telemetry = profilerState?.alpha_telemetry;
  const pillarsDeployed = telemetry?.pillars_deployed || [];
  const pillarsMissing = telemetry?.pillars_missing || [];

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {isStreaming && <span className={styles.pulse} />}
        {statusLabel && <span className={styles.statusText}>{statusLabel}</span>}
        {status === 'listening' && !held && (
          <span className={`${styles.statusText} ${styles.live}`}>LIVE</span>
        )}
        {held && <span className={`${styles.statusText} ${styles.held}`}>HELD</span>}
        {status === 'thinking' && <span className={`${styles.statusText} ${styles.thinking}`}>THINKING</span>}
        {status === 'streaming' && <span className={`${styles.statusText} ${styles.live}`}>STREAMING</span>}
        {status === 'disconnected' && <span className={`${styles.statusText} ${styles.disconnected}`}>⚠ WS DISCONNECTED</span>}
      </div>
      <div className={styles.right}>
        {/* Power dynamic indicator */}
        {profilerState?.room_power && (
          <span className={styles.profilerBadge} title={`Phase: ${profilerState.conversation_phase || '?'}`}>
            {profilerState.room_power === 'Alpha_dominant' ? '👑' :
             profilerState.room_power === 'Interviewer_dominant' ? '🎯' : '⚖️'}
          </span>
        )}
        {/* Pillar trackers */}
        {pillarsDeployed.length > 0 && (
          <span className={`${styles.pillarBadge} ${styles.deployed}`} title={`Deployed: ${pillarsDeployed.join(', ')}`}>
            ✅{pillarsDeployed.length}
          </span>
        )}
        {pillarsMissing.length > 0 && (
          <span className={`${styles.pillarBadge} ${styles.missing}`} title={`Missing: ${pillarsMissing.join(', ')}`}>
            ❌{pillarsMissing.length}
          </span>
        )}
        {copilotLatency > 0 && <span className={styles.latency}>{copilotLatency}ms</span>}
        {turnCount > 0 && <span className={styles.turns}>T{turnCount}</span>}
        <span className={styles.hint}>SPACE → hold | ESC → cover | ⌫ → burn context</span>
      </div>
    </div>
  );
}
