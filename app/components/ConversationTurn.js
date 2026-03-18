/**
 * ConversationTurn — Single Q&A pair with HUD response
 * 
 * Used by both HistoricalThread (frozen) and ActiveTurn (hot).
 * 
 * Props: { question, rawResponse }
 */
import HUDResponse from './hud/HUDResponse';
import styles from './ConversationTurn.module.css';

export default function ConversationTurn({ question, rawResponse }) {
  return (
    <div className={styles.turn}>
      <div className={styles.question}>
        <span className={styles.qLabel}>Q</span>
        <span className={styles.qText}>{question}</span>
      </div>
      <div className={styles.response}>
        {rawResponse ? (
          <HUDResponse raw={rawResponse} />
        ) : (
          <HUDResponse raw="" />
        )}
      </div>
    </div>
  );
}
