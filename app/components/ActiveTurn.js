/**
 * ActiveTurn — HOT streaming receiver
 * 
 * Re-renders 20x/sec during LLM streaming. This is intentional.
 * This component is a SIBLING of HistoricalThread, not a child.
 * Its re-renders never touch the historical DOM.
 * 
 * Props: { question, rawResponse, partialText, isActive }
 */
import ConversationTurn from './ConversationTurn';
import styles from './ActiveTurn.module.css';

export default function ActiveTurn({ question, rawResponse, partialText, isActive }) {
  // Nothing active — render nothing
  if (!isActive && !partialText) return null;

  return (
    <div className={styles.container}>
      {/* Live HUD response from the tactical router */}
      {isActive && question && (
        <ConversationTurn question={question} rawResponse={rawResponse || ''} />
      )}

      {/* Partial STT text (interim transcript) */}
      {partialText && (
        <div className={styles.partial}>
          <span className={styles.partialText}>{partialText}</span>
          <span className={styles.cursor}>|</span>
        </div>
      )}
    </div>
  );
}
