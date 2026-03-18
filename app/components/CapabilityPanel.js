/**
 * CapabilityPanel — Collapsible toggle strip for copilot capabilities
 * 
 * Props: {
 *   capabilities: Object,   // { terminalMode, clipboardCapture, autoStealth, keyterms, profiler, autoCopilot }
 *   onToggle: Function,     // (key) => void
 *   isOpen: boolean,        // Whether panel is expanded
 *   isStreaming: boolean,    // Whether WebSocket is active (disables keyterms toggle)
 * }
 * 
 * RF1: Keyterms toggle is disabled while streaming to prevent WebSocket teardown.
 * RF2: No Hold Gate — merged into Auto-Copilot.
 */
import styles from './CapabilityPanel.module.css';

const CAPABILITIES = [
  { key: 'terminalMode',     icon: '💻', label: 'Terminal',   description: 'Code-focused HUD + 2048 tokens' },
  { key: 'clipboardCapture', icon: '📋', label: 'Clipboard',  description: 'Capture code from Cmd+C' },
  { key: 'autoStealth',      icon: '👁',  label: 'Stealth',    description: 'Auto-cover on window blur' },
  { key: 'keyterms',         icon: '🔑', label: 'Keyterms',   description: 'Domain vocabulary for STT', disableWhileStreaming: true },
  { key: 'profiler',         icon: '🧠', label: 'Profiler',   description: 'Background behavioral analysis' },
  { key: 'autoCopilot',      icon: '🔔', label: 'Auto-Fire',  description: 'Auto-trigger copilot on silence' },
];

export default function CapabilityPanel({ capabilities, onToggle, isOpen, isStreaming }) {
  if (!isOpen) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        {CAPABILITIES.map(({ key, icon, label, description, disableWhileStreaming }) => {
          const isOn = capabilities[key];
          const isDisabled = disableWhileStreaming && isStreaming;

          return (
            <button
              key={key}
              className={`${styles.pill} ${isOn ? styles.on : styles.off} ${isDisabled ? styles.disabled : ''}`}
              onClick={() => !isDisabled && onToggle(key)}
              disabled={isDisabled}
              title={isDisabled ? `Cannot toggle while streaming — applies on next Start` : description}
            >
              <span className={styles.icon}>{icon}</span>
              <span className={styles.label}>{label}</span>
              <span className={styles.state}>{isOn ? 'ON' : 'OFF'}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.hint}>
        {isStreaming && <span className={styles.lockHint}>🔒 Keyterms locked during active session</span>}
      </div>
    </div>
  );
}
