/**
 * buildSystemPrompt.js — Zeta-Core v4.0
 *
 * Builds system prompts and user messages for the Interview Copilot LLM pipeline.
 *
 * Exports:
 *   buildProfilerPrompt()
 *   buildProfilerUserMessage(taggedTranscripts)
 *   buildContextBlock(profilerState)
 *   buildTacticalPrompt({ profilerState, speaker, terminalMode, isRescue, isCourseCorrect, isCandidateSupport, clientTelemetry })
 *   buildUserMessage({ transcript, speaker, mode, topicAnchor, turnId, clipboardCode, contextState, recentTurns })
 *   buildFollowUpPrompt(kb)
 */

// ─────────────────────────────────────────────
// PROFILER
// ─────────────────────────────────────────────

export function buildProfilerPrompt() {
  return `You are a silent background profiler for a technical interview assistant.

Your job: analyze the conversation transcript and extract a structured profile of the candidate and the interview.

OUTPUT FORMAT (JSON only, no markdown, no explanation):
{
  "role": "<job role being interviewed for>",
  "level": "<junior|mid|senior|staff|unknown>",
  "techStack": ["<tech1>", "<tech2>"],
  "topicsDiscussed": ["<topic1>", "<topic2>"],
  "candidateStrengths": ["<strength1>"],
  "candidateWeaknesses": ["<weakness1>"],
  "interviewStyle": "<behavioral|technical|system-design|mixed|unknown>",
  "currentPhase": "<intro|technical|behavioral|system-design|coding|closing|unknown>",
  "codingLanguage": "<language or null>",
  "keyEntities": ["<company, product, or domain mentioned>"],
  "sentimentSignal": "<positive|neutral|negative|mixed>",
  "confidence": <0.0-1.0>
}

RULES:
- Output ONLY valid JSON. No prose, no markdown fences.
- If uncertain, use "unknown" or null.
- techStack: only include technologies explicitly mentioned.
- topicsDiscussed: high-level topics (e.g. "system design", "arrays", "behavioral").
- Do NOT hallucinate details not present in the transcript.`;
}

export function buildProfilerUserMessage(taggedTranscripts) {
  const transcript = Array.isArray(taggedTranscripts)
    ? taggedTranscripts.join('\n')
    : (taggedTranscripts || '');
  return `[TRANSCRIPT TO PROFILE]:\n${transcript}`;
}

// ─────────────────────────────────────────────
// CONTEXT BLOCK (injected into tactical prompts)
// ─────────────────────────────────────────────

export function buildContextBlock(profilerState) {
  if (!profilerState) return '';

  const lines = [];
  if (profilerState.role && profilerState.role !== 'unknown') {
    lines.push(`ROLE: ${profilerState.role}`);
  }
  if (profilerState.level && profilerState.level !== 'unknown') {
    lines.push(`LEVEL: ${profilerState.level}`);
  }
  if (profilerState.interviewStyle && profilerState.interviewStyle !== 'unknown') {
    lines.push(`INTERVIEW STYLE: ${profilerState.interviewStyle}`);
  }
  if (profilerState.currentPhase && profilerState.currentPhase !== 'unknown') {
    lines.push(`CURRENT PHASE: ${profilerState.currentPhase}`);
  }
  if (profilerState.techStack && profilerState.techStack.length > 0) {
    lines.push(`TECH STACK: ${profilerState.techStack.join(', ')}`);
  }
  if (profilerState.topicsDiscussed && profilerState.topicsDiscussed.length > 0) {
    lines.push(`TOPICS DISCUSSED: ${profilerState.topicsDiscussed.join(', ')}`);
  }
  if (profilerState.codingLanguage) {
    lines.push(`CODING LANGUAGE: ${profilerState.codingLanguage}`);
  }
  if (profilerState.candidateStrengths && profilerState.candidateStrengths.length > 0) {
    lines.push(`CANDIDATE STRENGTHS: ${profilerState.candidateStrengths.join(', ')}`);
  }
  if (profilerState.candidateWeaknesses && profilerState.candidateWeaknesses.length > 0) {
    lines.push(`AREAS TO IMPROVE: ${profilerState.candidateWeaknesses.join(', ')}`);
  }
  if (lines.length === 0) return '';
  return '[INTERVIEW CONTEXT]:\n' + lines.join('\n');
}

// ─────────────────────────────────────────────
// TACTICAL PROMPTS
// ─────────────────────────────────────────────

function buildStandardTacticalPrompt(kb) {
  const contextBlock = kb.contextBlock ? kb.contextBlock + '\n\n' : '';
  return `You are Alpha — a real-time interview copilot whispering tactical guidance to a candidate mid-interview.

${contextBlock}MISSION:
The interviewer just asked a question. Give the candidate 3-5 crisp, actionable bullet points they can speak aloud RIGHT NOW.

OUTPUT FORMAT:
- Each bullet starts with "•"
- Max 15 words per bullet
- No preamble, no explanation, no markdown headers
- Speak in second person ("You should...", "Mention...", "Start with...")
- If the question is behavioral, use STAR framework cues
- If the question is technical, give the key insight first

HARD RULES:
- Output ONLY the bullet points. Nothing else.
- Do NOT repeat the question back.
- Do NOT say "Great question" or any filler.
- Do NOT exceed 5 bullets.
- GROUND every response in the ACTIVE PROBLEM. Do NOT reference Redis, Lambda, genomics, cloud infrastructure, or any technology not directly relevant to the current question.`;
}

function buildCandidateSupportPrompt(kb) {
  const contextBlock = kb.contextBlock ? kb.contextBlock + '\n\n' : '';
  return `You are Alpha — a real-time interview copilot helping a candidate who is currently speaking.

${contextBlock}MISSION:
The candidate is mid-answer. They may be rambling, losing the thread, or need a pivot. Give 2-3 tight bullets to help them land the answer cleanly.

OUTPUT FORMAT:
- Each bullet starts with "•"
- Max 12 words per bullet
- Speak in second person ("Wrap up with...", "Pivot to...", "Quantify...")
- No preamble, no explanation

RULES:
- Output ONLY the bullet points. Nothing else.
- Focus on LANDING the answer, not starting over.
- If they're rambling: give a "wrap up" cue first.
- If they're stuck: give the key technical insight.
- GROUND every response in the ACTIVE PROBLEM. Do NOT reference Redis, Lambda, genomics, cloud infrastructure, or any technology not directly relevant to the current question.`;
}

function buildCourseCorrectPrompt(kb) {
  const contextBlock = kb.contextBlock ? kb.contextBlock + '\n\n' : '';
  return `You are Alpha — a real-time interview copilot. The candidate has gone off-track or given an incorrect answer.

${contextBlock}MISSION:
Course-correct the candidate with 2-3 bullets. Help them recover gracefully without starting over.

OUTPUT FORMAT:
- Each bullet starts with "•"
- Max 15 words per bullet
- Speak in second person
- No preamble, no explanation

RULES:
- Output ONLY the bullet points. Nothing else.
- First bullet: acknowledge the pivot ("Actually, clarify that...")
- Second bullet: the correct direction
- Third bullet (optional): a concrete example or data point
- GROUND every response in the ACTIVE PROBLEM. Do NOT reference Redis, Lambda, genomics, cloud infrastructure, or any technology not directly relevant to the current question.`;
}

function buildTerminalModePrompt(kb) {
  const contextBlock = kb.contextBlock ? kb.contextBlock + '\n\n' : '';
  return `You are Alpha — a real-time interview copilot specialized in CODING INTERVIEWS.

${contextBlock}MISSION:
The candidate is in a live coding session. Give 3-5 tactical bullets focused on algorithm, complexity, and implementation.

OUTPUT FORMAT:
- Each bullet starts with "•"
- Max 20 words per bullet
- Lead with the algorithm or data structure
- Include time/space complexity when relevant
- Speak in second person

HARD RULES:
- Output ONLY the bullet points. Nothing else.
- Always mention time complexity if it's an algorithm question.
- If there's a brute force vs optimal tradeoff, name both.
- Mention edge cases the candidate should handle.
- Do NOT write actual code — give the approach, not the implementation.
- GROUND every response in the ACTIVE PROBLEM. Do NOT reference Redis, Lambda, genomics, cloud infrastructure, or any technology not directly relevant to the current question.`;
}

function buildRescuePrompt(kb, activeProblem = null, lastInterviewerQuestion = null) {
  const contextBlock = kb.contextBlock ? kb.contextBlock + '\n\n' : '';
  return `You are Alpha — a real-time interview copilot. RESCUE MODE ACTIVATED.

${contextBlock}ALPHA'S BACKGROUND:
${kb.background || 'Experienced software engineer.'}

ACTIVE PROBLEM: ${activeProblem || lastInterviewerQuestion || "(unknown — use Alpha's partial transcript as context)"}

SITUATION:
The candidate has stalled, gone silent, or is visibly struggling. This is an emergency assist.

MISSION:
Give 3 rescue bullets that help the candidate re-engage RIGHT NOW. Be direct, concrete, and confidence-boosting.

OUTPUT FORMAT:
- Each bullet starts with "•"
- Max 15 words per bullet
- Speak in second person
- No preamble, no explanation

RULES:
- Output ONLY the bullet points. Nothing else.
- First bullet: re-anchor to the question ("The core ask is...")
- Second bullet: a concrete starting point or approach
- Third bullet: a confidence signal ("You've handled X before...")
- GROUND every response in the ACTIVE PROBLEM context. Do NOT reference Redis, Lambda, genomics, cloud infrastructure, or any technology not directly relevant to what Alpha just said.`;
}

// ─────────────────────────────────────────────
// FOLLOW-UP PROMPT
// ─────────────────────────────────────────────

export function buildFollowUpPrompt(kb) {
  const contextBlock = kb.contextBlock ? kb.contextBlock + '\n\n' : '';
  return `You are Alpha — a real-time interview copilot. The interviewer has asked a follow-up question.

${contextBlock}MISSION:
The candidate just answered and the interviewer is probing deeper. Give 2-4 bullets to help them go deeper or pivot.

OUTPUT FORMAT:
- Each bullet starts with "•"
- Max 15 words per bullet
- Speak in second person
- No preamble, no explanation

RULES:
- Output ONLY the bullet points. Nothing else.
- If it's a "why" follow-up: give the reasoning chain.
- If it's a "how" follow-up: give the implementation steps.
- If it's a "what if" follow-up: address the edge case directly.`;
}

// ─────────────────────────────────────────────
// TACTICAL PROMPT ROUTER
// ─────────────────────────────────────────────

export function buildTacticalPrompt({
  profilerState,
  speaker,
  terminalMode = false,
  isRescue = false,
  isCourseCorrect = false,
  isCandidateSupport = false,
  clientTelemetry = {},
}) {
  const contextBlock = buildContextBlock(profilerState);
  const kb = {
    contextBlock,
    background: profilerState?.candidateStrengths?.join(', ') || '',
  };

  if (isRescue) {
    return buildRescuePrompt(kb, clientTelemetry?.activeProblem, clientTelemetry?.lastInterviewerQuestion);
  }

  if (terminalMode) {
    return buildTerminalModePrompt(kb);
  }

  if (isCourseCorrect) {
    return buildCourseCorrectPrompt(kb);
  }

  if (isCandidateSupport || speaker === 'candidate') {
    return buildCandidateSupportPrompt(kb);
  }

  return buildStandardTacticalPrompt(kb);
}

// ─────────────────────────────────────────────
// USER MESSAGE BUILDER
// ─────────────────────────────────────────────

export function buildUserMessage({
  transcript,
  speaker = 'interviewer',
  mode = 'standard',
  topicAnchor = null,
  turnId = null,
  clipboardCode = null,
  contextState = null,
  recentTurns = [],
}) {
  let msg = '[SPEAKER]: ' + speaker.toUpperCase();
  msg += '\n[MODE]: ' + mode.toUpperCase();
  if (turnId !== null) msg += '\n[TURN_ID]: ' + turnId;

  // Active problem anchor — ground every response in the real question
  if (topicAnchor) {
    msg += '\n[ACTIVE PROBLEM]: ' + topicAnchor;
  }

  msg += '\n[LIVE TRANSCRIPT]: ' + transcript;

  // Recent normalized turns (last 3, for inline context)
  if (recentTurns && recentTurns.length > 0) {
    const turnLines = recentTurns.slice(-3).map(t =>
      `  [${t.role?.toUpperCase() || 'UNKNOWN'} turn_${t.turn_order}]: ${t.text}`
    ).join('\n');
    msg += '\n[RECENT TURNS]:\n' + turnLines;
  }

  if (contextState) msg += '\n[ACTIVE CONTEXT]: ' + contextState;
  if (clipboardCode) msg += '\n<CODE>\n' + clipboardCode + '\n</CODE>';

  return msg;
}
