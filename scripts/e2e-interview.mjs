#!/usr/bin/env node
/**
 * E2E Interview Pipeline Test
 * 
 * Transcribes a real mock interview MP3 via AssemblyAI batch API,
 * then runs each interviewer question through the full copilot pipeline.
 * 
 * Usage:
 *   node scripts/e2e-interview.mjs "/path/to/interview.mp3"
 * 
 * Requires:
 *   - ASSEMBLYAI_API_KEY in .env.local
 *   - Next.js dev server running on localhost:3000 (for copilot API)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env.local ──
function loadEnv() {
  try {
    const envContent = readFileSync(join(ROOT, '.env.local'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    }
  } catch {}
}

loadEnv();

const AAI_KEY = process.env.ASSEMBLYAI_API_KEY;
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const MP3_PATH = process.argv[2];

if (!MP3_PATH) {
  console.error('Usage: node scripts/e2e-interview.mjs "/path/to/interview.mp3"');
  process.exit(1);
}
if (!AAI_KEY) {
  console.error('ASSEMBLYAI_API_KEY not set in .env.local');
  process.exit(1);
}

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', magenta: '\x1b[35m',
};

// ═══════════════════════════════════════════
// STEP 1: Upload MP3 to AssemblyAI
// ═══════════════════════════════════════════
async function uploadFile(filePath) {
  console.log(`${C.cyan}[1/4] Uploading ${filePath}...${C.reset}`);
  const fileBuffer = readFileSync(filePath);
  const res = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      'Authorization': AAI_KEY,
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const { upload_url } = await res.json();
  console.log(`${C.green}  ✓ Uploaded: ${upload_url.slice(0, 60)}...${C.reset}`);
  return upload_url;
}

// ═══════════════════════════════════════════
// STEP 2: Batch transcribe with speaker diarization
// ═══════════════════════════════════════════
async function transcribe(audioUrl) {
  console.log(`${C.cyan}[2/4] Transcribing with speaker diarization...${C.reset}`);
  const res = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': AAI_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
      speech_models: ['universal-3-pro', 'universal-2'],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Transcription request failed: ${res.status} — ${errBody}`);
  }
  const { id } = await res.json();
  console.log(`${C.dim}  Transcript ID: ${id}${C.reset}`);

  // Poll for completion
  let transcript;
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'Authorization': AAI_KEY },
    });
    transcript = await pollRes.json();
    process.stdout.write(`\r  Status: ${transcript.status}   `);
    if (transcript.status === 'completed') break;
    if (transcript.status === 'error') throw new Error(`Transcription error: ${transcript.error}`);
  }
  console.log(`\n${C.green}  ✓ Transcription complete: ${transcript.utterances?.length || 0} utterances${C.reset}`);
  return transcript;
}

// ═══════════════════════════════════════════
// STEP 3: Group utterances into conversation turns
// ═══════════════════════════════════════════
function groupTurns(utterances) {
  if (!utterances || utterances.length === 0) return [];

  const turns = [];
  let currentSpeaker = utterances[0].speaker;
  let currentText = utterances[0].text;
  let currentStart = utterances[0].start;

  for (let i = 1; i < utterances.length; i++) {
    const u = utterances[i];
    if (u.speaker === currentSpeaker) {
      // Same speaker — merge (this handles mid-sentence pauses!)
      currentText += ' ' + u.text;
    } else {
      // New speaker — push previous turn
      turns.push({ speaker: currentSpeaker, text: currentText, startMs: currentStart });
      currentSpeaker = u.speaker;
      currentText = u.text;
      currentStart = u.start;
    }
  }
  turns.push({ speaker: currentSpeaker, text: currentText, startMs: currentStart });

  return turns;
}

// ═══════════════════════════════════════════
// STEP 4: Run each interviewer turn through copilot
// ═══════════════════════════════════════════
async function runCopilotPipeline(turns) {
  console.log(`\n${C.cyan}[3/4] Running copilot pipeline on ${turns.length} turns...${C.reset}`);
  
  const history = [];
  const results = [];
  let interviewerTurns = 0;
  let copilotFires = 0;
  let totalLatency = 0;
  const errors = [];

  // Determine which speaker is the interviewer (ask more questions = shorter utterances on average)
  const speakerStats = {};
  for (const t of turns) {
    if (!speakerStats[t.speaker]) speakerStats[t.speaker] = { count: 0, totalLen: 0 };
    speakerStats[t.speaker].count++;
    speakerStats[t.speaker].totalLen += t.text.length;
  }
  
  // The interviewer typically has more turns (asks questions), candidate has longer responses
  let interviewerSpeaker = null;
  let maxTurns = 0;
  for (const [speaker, stats] of Object.entries(speakerStats)) {
    console.log(`  Speaker ${speaker}: ${stats.count} turns, avg ${Math.round(stats.totalLen / stats.count)} chars`);
    if (stats.count > maxTurns) {
      maxTurns = stats.count;
      interviewerSpeaker = speaker;
    }
  }
  console.log(`  → Interviewer detected as: Speaker ${interviewerSpeaker}\n`);

  // Cap to first 10 interviewer turns for testing speed
  const MAX_COPILOT_CALLS = 10;

  for (let i = 0; i < turns.length && copilotFires < MAX_COPILOT_CALLS; i++) {
    const turn = turns[i];
    const timestamp = `${Math.floor(turn.startMs / 60000)}:${String(Math.floor((turn.startMs % 60000) / 1000)).padStart(2, '0')}`;
    const isInterviewer = turn.speaker === interviewerSpeaker;
    const label = isInterviewer ? `${C.yellow}Interviewer${C.reset}` : `${C.magenta}Candidate${C.reset}`;

    console.log(`${C.dim}[${timestamp}]${C.reset} ${label}: ${turn.text.slice(0, 100)}${turn.text.length > 100 ? '...' : ''}`);

    if (!isInterviewer) {
      // Candidate turn — add to history context but don't fire copilot
      continue;
    }

    interviewerTurns++;

    // Fire copilot
    try {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}/api/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: turn.text,
          history: history.slice(-5), // Last 5 turns for context
          profilerState: null,
          clientTelemetry: { isRambling: false },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const event = JSON.parse(trimmed.slice(5).trim());
            if (event.done) break;
            if (event.token) fullText += event.token;
          } catch {}
        }
      }

      const latency = Date.now() - start;
      totalLatency += latency;
      copilotFires++;

      // Check HUD structure
      const hasMotive = fullText.includes('[MOTIVE]');
      const hasMove = fullText.includes('[THE MOVE]') || fullText.includes('[MOVE]');
      const hasBait = fullText.includes('[BAIT]') || fullText.includes('[THE BAIT]');
      const hasOverride = fullText.includes('[COURSE CORRECT]');

      const hudType = hasOverride ? 'OVERRIDE' : (hasMotive ? 'STANDARD' : 'UNKNOWN');

      console.log(`  ${C.green}→ COPILOT [${hudType}]${C.reset} ${latency}ms | ${fullText.length} chars | MOTIVE:${hasMotive} MOVE:${hasMove} BAIT:${hasBait}`);
      
      // Show first 2 lines of response
      const preview = fullText.split('\n').filter(l => l.trim()).slice(0, 2).join(' | ');
      console.log(`    ${C.dim}${preview.slice(0, 150)}${C.reset}`);

      history.push({
        question: turn.text,
        response: fullText.split('\n').filter(l => l.trim()),
        rawResponse: fullText,
      });

      results.push({ turn: i, question: turn.text.slice(0, 80), hudType, latency, chars: fullText.length, hasMotive, hasMove, hasBait });
    } catch (err) {
      errors.push({ turn: i, error: err.message });
      console.log(`  ${C.red}→ ERROR: ${err.message}${C.reset}`);
    }
  }

  return { results, errors, interviewerTurns, copilotFires, totalLatency };
}

// ═══════════════════════════════════════════
// STEP 5: Summary report
// ═══════════════════════════════════════════
function printReport({ results, errors, interviewerTurns, copilotFires, totalLatency, turnCount, diarizationWorked }) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${C.bold}E2E PIPELINE REPORT${C.reset}`);
  console.log(`${'═'.repeat(60)}`);
  
  console.log(`\n${C.bold}Transcription:${C.reset}`);
  console.log(`  Total turns: ${turnCount}`);
  console.log(`  Diarization: ${diarizationWorked ? `${C.green}✓ Working${C.reset}` : `${C.red}✗ Failed${C.reset}`}`);
  console.log(`  Interviewer turns: ${interviewerTurns}`);
  
  console.log(`\n${C.bold}Copilot:${C.reset}`);
  console.log(`  Fires: ${copilotFires}`);
  console.log(`  Avg latency: ${copilotFires > 0 ? Math.round(totalLatency / copilotFires) : 0}ms`);
  console.log(`  Errors: ${errors.length}`);

  // HUD quality
  const standardCount = results.filter(r => r.hudType === 'STANDARD').length;
  const overrideCount = results.filter(r => r.hudType === 'OVERRIDE').length;
  const unknownCount = results.filter(r => r.hudType === 'UNKNOWN').length;
  const motiveRate = results.filter(r => r.hasMotive).length / (results.length || 1) * 100;
  const moveRate = results.filter(r => r.hasMove).length / (results.length || 1) * 100;
  const baitRate = results.filter(r => r.hasBait).length / (results.length || 1) * 100;

  console.log(`\n${C.bold}HUD Quality:${C.reset}`);
  console.log(`  Standard HUDs: ${standardCount}`);
  console.log(`  Override HUDs: ${overrideCount}`);
  console.log(`  Unknown format: ${unknownCount}`);
  console.log(`  MOTIVE hit rate: ${motiveRate.toFixed(0)}%`);
  console.log(`  MOVE hit rate: ${moveRate.toFixed(0)}%`);
  console.log(`  BAIT hit rate: ${baitRate.toFixed(0)}%`);

  // Gaps
  console.log(`\n${C.bold}${C.red}GAPS DETECTED:${C.reset}`);
  if (unknownCount > 0) console.log(`  ${C.red}⚠ ${unknownCount} responses missing HUD structure${C.reset}`);
  if (motiveRate < 80) console.log(`  ${C.red}⚠ MOTIVE tag only ${motiveRate.toFixed(0)}% — LLM not following format${C.reset}`);
  if (moveRate < 80) console.log(`  ${C.red}⚠ MOVE tag only ${moveRate.toFixed(0)}% — LLM not following format${C.reset}`);
  if (errors.length > 0) console.log(`  ${C.red}⚠ ${errors.length} API errors (check server logs)${C.reset}`);
  const avgLat = copilotFires > 0 ? totalLatency / copilotFires : 0;
  if (avgLat > 5000) console.log(`  ${C.red}⚠ Avg latency ${Math.round(avgLat)}ms — too slow for live interview${C.reset}`);
  if (!diarizationWorked) console.log(`  ${C.red}⚠ Diarization failed — cannot distinguish interviewer from candidate${C.reset}`);
  if (unknownCount === 0 && motiveRate >= 80 && moveRate >= 80 && errors.length === 0 && avgLat <= 5000) {
    console.log(`  ${C.green}✓ No critical gaps detected!${C.reset}`);
  }

  console.log(`\n${'═'.repeat(60)}\n`);
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${C.bold}STEALTH COPILOT — E2E PIPELINE TEST${C.reset}`);
  console.log(`File: ${MP3_PATH}`);
  console.log(`Server: ${BASE_URL}`);
  console.log(`${'═'.repeat(60)}\n`);

  // 1. Upload
  const audioUrl = await uploadFile(MP3_PATH);

  // 2. Transcribe with diarization
  const transcript = await transcribe(audioUrl);
  const diarizationWorked = transcript.utterances && transcript.utterances.length > 0;

  // 3. Group into turns
  const turns = diarizationWorked ? groupTurns(transcript.utterances) : [];
  console.log(`\n${C.cyan}[3/4] Grouped into ${turns.length} conversation turns${C.reset}`);

  if (turns.length === 0) {
    console.error(`${C.red}No turns detected — diarization may have failed.${C.reset}`);
    console.log(`Raw transcript (first 500 chars): ${transcript.text?.slice(0, 500)}`);
    process.exit(1);
  }

  // 4. Run copilot pipeline
  const pipeline = await runCopilotPipeline(turns);

  // 5. Report
  printReport({
    ...pipeline,
    turnCount: turns.length,
    diarizationWorked,
  });
}

main().catch(err => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
