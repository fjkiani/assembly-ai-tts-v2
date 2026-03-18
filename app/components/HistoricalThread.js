/**
 * HistoricalThread — FROZEN during streams
 * 
 * React.memo'd. Only re-renders when bulletHistory.length changes
 * (i.e., a turn completes and gets pushed). During live LLM streaming,
 * this component is completely inert — zero CPU on history.
 * 
 * Props: { bulletHistory }
 */
import { memo } from 'react';
import ConversationTurn from './ConversationTurn';
import styles from './HistoricalThread.module.css';

function HistoricalThreadInner({ bulletHistory }) {
  if (!bulletHistory || bulletHistory.length === 0) return null;

  return (
    <div className={styles.thread}>
      {bulletHistory.map((h, idx) => (
        <ConversationTurn
          key={idx}
          question={h.question}
          rawResponse={h.rawResponse || h.bullets?.join('\n') || ''}
        />
      ))}
    </div>
  );
}

// Custom comparator: only re-render if the array length changed
const HistoricalThread = memo(HistoricalThreadInner, (prev, next) => {
  return prev.bulletHistory.length === next.bulletHistory.length;
});

export default HistoricalThread;
