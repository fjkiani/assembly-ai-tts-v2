/**
 * FollowUpPanel — Post-session intelligence brief with markdown rendering
 * 
 * Props: { followUp, onCopy }
 * 
 * FollowUpMarkdown is private to this component — not exposed.
 */
import styles from './FollowUpPanel.module.css';

// ── Private markdown renderer ──
function FollowUpMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');

  return (
    <div className={styles.md}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className={styles.spacer} />;
        if (trimmed.startsWith('## ')) return <h2 key={i} className={styles.h2}>{trimmed.slice(3)}</h2>;
        if (trimmed.startsWith('### ')) return <h3 key={i} className={styles.h3}>{trimmed.slice(4)}</h3>;
        if (/^\d+\.\s/.test(trimmed)) {
          return <div key={i} className={styles.numbered}>{trimmed}</div>;
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
          return <div key={i} className={styles.bullet}>{trimmed.slice(2)}</div>;
        }
        if (trimmed.startsWith('|')) {
          return <div key={i} className={styles.tableRow}><code>{trimmed}</code></div>;
        }
        const boldParsed = trimmed.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        return <p key={i} className={styles.p} dangerouslySetInnerHTML={{ __html: boldParsed }} />;
      })}
    </div>
  );
}

export default function FollowUpPanel({ followUp, onCopy }) {
  if (!followUp) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>📋 Post-Session Follow-Up Brief</span>
        <button className={styles.copyBtn} onClick={onCopy} title="Copy to clipboard">
          📄 Copy
        </button>
      </div>
      <div>
        <FollowUpMarkdown text={followUp} />
      </div>
    </div>
  );
}
