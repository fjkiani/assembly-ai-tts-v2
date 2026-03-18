/**
 * RamblingBanner — Isolated 90-second speaking guard
 * 
 * CRITICAL ARCHITECTURE: This component owns its own timer state.
 * It reads from speakingStartRef (a React ref, NOT state) so ticking
 * every 1s does NOT propagate re-renders to page.js or any sibling.
 * 
 * Props: { speakingStartRef } — ref from useTranscription hook
 */
'use client';

import { useState, useEffect } from 'react';
import styles from './RamblingBanner.module.css';

const RAMBLING_THRESHOLD_MS = 90_000; // 90 seconds
const CHECK_INTERVAL_MS = 1000;       // Check every 1s

export default function RamblingBanner({ speakingStartRef }) {
  const [isRambling, setIsRambling] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const start = speakingStartRef?.current;
      if (start && Date.now() - start >= RAMBLING_THRESHOLD_MS) {
        setIsRambling(true);
      } else {
        setIsRambling(false);
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [speakingStartRef]);

  if (!isRambling) return null;

  return (
    <div className={styles.banner}>
      ⚠️ WRAP IT UP — You&apos;ve been talking for 90+ seconds
    </div>
  );
}
