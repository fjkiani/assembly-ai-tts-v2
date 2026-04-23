/**
 * parseHUD.js — Pure parsing functions for the Stealth Copilot HUD
 *
 * Zero React imports. Pure string → object/array transforms.
 * Unit-testable.
 *
 * Exports:
 *   parseHUDSections(raw) → { phase, ... }
 *   parseSegments(text) → [{ type: 'text'|'code', content, lang? }]
 *
 * Phases returned:
 *   'thinking'  — incomplete THINK block still streaming
 *   'waiting'   — empty after stripping
 *   'override'  — [COURSE CORRECT] / [THE PIVOT MOVE] / RED LIGHT
 *   'rescue'    — [RESCUE] / [THE PIVOT]
 *   'support'   — [ALPHA IS SPEAKING] / [STRENGTHEN] / [WATCH OUT]
 *   'hud'       — [MOTIVE] / [DELIVERY] / [THE MOVE] / [THE BAIT]
 *   'plain'     — no sections detected, raw text
 */

// ── Section extractor helper ──
// Extracts content between [TAG] and the next [TAG] or end of string
function extractSection(text, tag) {
  const pattern = new RegExp(
    '\\[' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s*([\\s\\S]*?)(?=\\n\\[|$)',
    'i'
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

// ── Bullet list extractor ──
// Returns array of bullet strings from a section
function extractBullets(sectionText) {
  if (!sectionText) return [];
  return sectionText
    .split('\n')
    .map(l => l.replace(/^[\s•\-\*\d.)+]+/, '').trim())
    .filter(l => l.length > 0);
}

/**
 * Parse raw LLM output into structured HUD sections.
 */
export function parseHUDSections(raw) {
  if (!raw) return null;

  // Strip completed THINK/PLAN blocks
  let text = raw
    .replace(/<THINK>[\s\S]*?<\/THINK>\s*/gi, '')
    .replace(/<PLAN>[\s\S]*?<\/PLAN>\s*/gi, '')
    .replace(/<\/?EXECUTE>/gi, '');

  // Detect incomplete THINK block (still streaming)
  const thinkOpen = raw.lastIndexOf('<THINK>');
  const thinkClose = raw.lastIndexOf('</THINK>');
  if (thinkOpen !== -1 && thinkOpen > thinkClose) {
    return { phase: 'thinking' };
  }

  text = text.trim();
  if (!text) return { phase: 'waiting' };

  // ── RESCUE phase: [RESCUE] + [THE PIVOT] ──
  if (/\[RESCUE\]/i.test(text)) {
    const rescue = extractSection(text, 'RESCUE');
    const pivot = extractSection(text, 'THE PIVOT');
    return {
      phase: 'rescue',
      rescue,
      pivot,
    };
  }

  // ── SUPPORT phase: [ALPHA IS SPEAKING] + [STRENGTHEN] + [WATCH OUT] ──
  if (/\[ALPHA IS SPEAKING\]/i.test(text) || /\[STRENGTHEN\]/i.test(text)) {
    const speaking = extractSection(text, 'ALPHA IS SPEAKING');
    const strengthen = extractSection(text, 'STRENGTHEN');
    const watchOut = extractSection(text, 'WATCH OUT');
    return {
      phase: 'support',
      speaking,
      strengthen: extractBullets(strengthen),
      watchOut: extractBullets(watchOut),
    };
  }

  // ── OVERRIDE phase: [COURSE CORRECT] ──
  if (/\[COURSE CORRECT\]/i.test(text)) {
    const courseCorrect = extractSection(text, 'COURSE CORRECT');
    const pivotMove = extractSection(text, 'THE PIVOT MOVE');
    const bait = extractSection(text, 'THE BAIT');
    return {
      phase: 'override',
      courseCorrect,
      pivotMove,
      bait,
      diagnostic: courseCorrect, // backward compat
    };
  }

  // ── HUD phase: [MOTIVE] / [DELIVERY] / [THE MOVE] / [THE BAIT] ──
  if (/\[MOTIVE\]/i.test(text) || /\[THE MOVE\]/i.test(text)) {
    const motive = extractSection(text, 'MOTIVE');
    const delivery = extractSection(text, 'DELIVERY');
    const move = extractSection(text, 'THE MOVE');
    const bait = extractSection(text, 'THE BAIT');
    return {
      phase: 'hud',
      motive,
      delivery,
      move,
      bait,
      diagnostic: null, // HUDStandard was rendering parsed.diagnostic (always null) — now explicit
    };
  }

  // ── PLAIN fallback ──
  return { phase: 'plain', text };
}

/**
 * Parse text into segments: plain text and fenced code blocks.
 * Returns array of { type: 'text'|'code', content, lang? }
 */
export function parseSegments(text) {
  if (!text) return [];
  const segments = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index).trim();
      if (textContent) segments.push({ type: 'text', content: textContent });
    }
    segments.push({ type: 'code', content: match[2], lang: match[1] || 'text' });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ type: 'text', content: remaining });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}
