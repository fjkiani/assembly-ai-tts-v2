/**
 * parseHUD.js — Pure parsing functions for the Stealth Copilot HUD
 * 
 * Zero React imports. Pure string → object/array transforms.
 * Unit-testable. Used by HUDResponse, ActiveTurn, and any future consumer.
 * 
 * Exports:
 *   parseHUDSections(raw) → { phase, motive?, delivery?, move?, bait?, diagnostic?, ... }
 *   parseSegments(text)   → [{ type: 'text'|'code', content, lang? }]
 */

/**
 * Parse raw LLM output into structured HUD sections.
 * 
 * Returns one of:
 *   { phase: 'thinking' }                                    — incomplete THINK block
 *   { phase: 'waiting' }                                     — empty after stripping
 *   { phase: 'override', courseCorrect, pivotMove, diagnostic } — RED LIGHT
 *   { phase: 'hud', motive, delivery, move, bait, diagnostic } — standard 5-section
 *   { phase: 'plain', text }                                   — no sections detected
 * 
 * @param {string} raw — Raw LLM output string
 * @returns {object|null}
 */
export function parseHUDSections(raw) {
  if (!raw) return null;

  // Safety: strip any leaked THINK blocks that completed
  let text = raw.replace(/<THINK[\s\S]*?<\/THINK>/gi, '');
  text = text.replace(/<\/?EXECUTE>/gi, '');

  // Detect incomplete THINK block (still reasoning)
  const thinkOpen = raw.lastIndexOf('<THINK');
  const thinkClose = raw.lastIndexOf('</THINK');
  if (thinkOpen >= 0 && (thinkClose < 0 || thinkClose < thinkOpen)) {
    return { phase: 'thinking' };
  }

  text = text.trim();
  if (!text) return { phase: 'waiting' };

  // ── Override mode: [COURSE CORRECT] ──
  const isOverride = /\[COURSE CORRECT\]/i.test(text);

  if (isOverride) {
    const ccMatch = text.match(/\[COURSE CORRECT\]\s*([\s\S]*?)(?=\[THE PIVOT MOVE\]|$)/i);
    const pivotMatch = text.match(/\[THE PIVOT MOVE\]\s*([\s\S]*?)(?=\[THE DIAGNOSTIC\]|$)/i);
    const diagMatch = text.match(/\[THE DIAGNOSTIC\]\s*([\s\S]*?)$/i);

    return {
      phase: 'override',
      courseCorrect: (ccMatch?.[1] || '').trim(),
      pivotMove: (pivotMatch?.[1] || '').trim(),
      diagnostic: (diagMatch?.[1] || '').trim(),
    };
  }

  // ── Terminal Mode: [ALGORITHM], [COMPLEXITY], [EDGE CASES], [THE CODE] ──
  const isTerminal = /\[ALGORITHM\]/i.test(text);

  if (isTerminal) {
    const algoMatch = text.match(/\[ALGORITHM\]\s*([\s\S]*?)(?=\[COMPLEXITY\]|$)/i);
    const compMatch = text.match(/\[COMPLEXITY\]\s*([\s\S]*?)(?=\[EDGE CASES\]|$)/i);
    const edgeMatch = text.match(/\[EDGE CASES\]\s*([\s\S]*?)(?=\[THE CODE\]|$)/i);
    const codeMatch = text.match(/\[THE CODE\]\s*([\s\S]*?)$/i);

    return {
      phase: 'terminal',
      algorithm: (algoMatch?.[1] || '').trim(),
      complexity: (compMatch?.[1] || '').trim(),
      edgeCases: (edgeMatch?.[1] || '').trim(),
      code: (codeMatch?.[1] || '').trim(),
    };
  }

  // ── Standard HUD: [MOTIVE], [DELIVERY], [THE MOVE], [THE BAIT], [THE DIAGNOSTIC] ──
  const motiveMatch = text.match(/\[MOTIVE\]\s*([\s\S]*?)(?=\[DELIVERY\]|\[TRAP\]|\[THE MOVE\]|\[MOVE\]|$)/i);
  const deliveryMatch = text.match(/\[DELIVERY\]\s*([\s\S]*?)(?=\[THE MOVE\]|\[MOVE\]|$)/i);
  const moveMatch = text.match(/\[(?:THE )?MOVE\]\s*([\s\S]*?)(?=\[THE BAIT\]|\[BAIT\]|\[THE DIAGNOSTIC\]|$)/i);
  const baitMatch = text.match(/\[(?:THE )?BAIT\]\s*([\s\S]*?)(?=\[THE DIAGNOSTIC\]|$)/i);
  const diagMatch = text.match(/\[THE DIAGNOSTIC\]\s*([\s\S]*?)$/i);

  const hasSections = motiveMatch || deliveryMatch || moveMatch || baitMatch || diagMatch;
  if (!hasSections) return { phase: 'plain', text };

  return {
    phase: 'hud',
    motive: (motiveMatch?.[1] || '').trim(),
    delivery: (deliveryMatch?.[1] || '').trim(),
    move: (moveMatch?.[1] || '').trim(),
    bait: (baitMatch?.[1] || '').trim(),
    diagnostic: (diagMatch?.[1] || '').trim(),
  };
}

/**
 * Parse a text block into an array of renderable segments.
 * 
 * Handles:
 *   - Fenced code blocks (```lang ... ```) → { type: 'code', content, lang }
 *   - Bullet/numbered lines → { type: 'text', content: string[] }
 * 
 * @param {string} text — A section of HUD output (e.g., the MOVE content)
 * @returns {Array<{type: 'text'|'code', content: string|string[], lang?: string}>}
 */
export function parseSegments(text) {
  if (!text) return [];

  const segments = [];
  const lines = text.split('\n');
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let textLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```') && !inCode) {
      // Entering code block — flush pending text
      if (textLines.length > 0) {
        segments.push({ type: 'text', content: textLines });
        textLines = [];
      }
      inCode = true;
      codeLang = trimmed.slice(3).trim() || '';
      codeLines = [];
    } else if (trimmed.startsWith('```') && inCode) {
      // Exiting code block
      segments.push({ type: 'code', content: codeLines.join('\n'), lang: codeLang });
      inCode = false;
      codeLines = [];
    } else if (inCode) {
      codeLines.push(line);
    } else {
      // Strip bullet markers: •, -, *, numbered (1. 2.) and leading whitespace
      const cleaned = line.replace(/^[\s\u2022\-\*\d.)+]+/, '').trim();
      if (cleaned) textLines.push(cleaned);
    }
  }

  // Flush remaining
  if (inCode && codeLines.length > 0) {
    segments.push({ type: 'code', content: codeLines.join('\n'), lang: codeLang });
  }
  if (textLines.length > 0) {
    segments.push({ type: 'text', content: textLines });
  }

  return segments;
}
