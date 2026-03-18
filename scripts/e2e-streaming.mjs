#!/usr/bin/env node
/**
 * REAL Streaming E2E Test — Full Interview, No Sandbagging
 * 
 * Simulates the EXACT frontend experience:
 *   1. Converts MP3 → 16kHz mono PCM (same as browser AudioContext)
 *   2. Gets a streaming token via /api/token
 *   3. Opens v3 WebSocket with DOMAIN_KEYTERMS injected
 *   4. Feeds audio at 4x real-time (AssemblyAI accepts faster-than-realtime)
 *   5. Logs every Turn event — partials, end_of_turn, timing
 *   6. Runs debounce accumulator (2.5s) + speaker gate
 *   7. Fires copilot on debounce flush
 *   8. Generates full gap report
 * 
 * Usage:
 *   node scripts/e2e-streaming.mjs "/path/to/interview.mp3"
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import WebSocket from 'ws';

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
      if (key && rest.length > 0) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch {}
}
loadEnv();

// ── Domain keyterms (same as constants.js) ──
const DOMAIN_KEYTERMS = [
  'CI/CD', 'HIPAA', 'SOC2', 'Zero-Trust', 'RBAC',
  'VPC', 'IAM', 'EKS', 'S3', 'Terraform',
  'Kubernetes', 'Docker', 'microservices',
  'Datadog', 'LangFuse', 'Grafana', 'Prometheus',
  'OpenTelemetry', 'distributed tracing',
  'LLM', 'RAG', 'fine-tuning', 'prompt engineering',
  'embeddings', 'vector database', 'agentic',
  'hallucination', 'guardrails', 'eval framework',
  'DevSecOps', 'SAST', 'DAST', 'penetration testing',
  'vulnerability scanning', 'shift left',
  'ETL', 'data pipeline', 'Talend', 'Snowflake',
  'Delta Lake', 'data governance',
  'sprint', 'standup', 'retrospective', 'Jira',
  'epics', 'story points',
];

const AAI_KEY = process.env.ASSEMBLYAI_API_KEY;
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const MP3_PATH = process.argv[2];
const DEBOUNCE_MS = 2500;
const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 4096; // samples per chunk (same as browser ScriptProcessorNode)
const BYTES_PER_CHUNK = CHUNK_SIZE * 2; // 16-bit = 2 bytes per sample
const REALTIME_INTERVAL_MS = Math.round((CHUNK_SIZE / SAMPLE_RATE) * 1000); // ~256ms
const SPEED_MULTIPLIER = 2; // Feed at 2x realtime (4x causes 3007 rate limit)
const FEED_INTERVAL_MS = Math.max(10, Math.round(REALTIME_INTERVAL_MS / SPEED_MULTIPLIER)); // ~64ms

if (!MP3_PATH) {
  console.error('Usage: node scripts/e2e-streaming.mjs "/path/to/interview.mp3"');
  process.exit(1);
}

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m',
};

// ═══════════════════════════════════════════
// STEP 1: Convert full MP3 → 16kHz mono PCM
// ═══════════════════════════════════════════
function convertToPCM(mp3Path) {
  console.log(`${C.cyan}[1/4] Converting FULL MP3 → 16kHz mono PCM...${C.reset}`);
  const result = execSync(
    `ffmpeg -i "${mp3Path}" -f s16le -ac 1 -ar 16000 - 2>/dev/null`,
    { maxBuffer: 500 * 1024 * 1024 } // 500MB
  );
  const audioDuration = (result.length / SAMPLE_RATE / 2).toFixed(1);
  console.log(`${C.green}  ✓ ${(result.length / 1024 / 1024).toFixed(1)}MB PCM (${audioDuration}s = ${(audioDuration / 60).toFixed(1)} min)${C.reset}`);
  console.log(`${C.dim}  Feed rate: ${SPEED_MULTIPLIER}x → estimate ${(audioDuration / SPEED_MULTIPLIER / 60).toFixed(1)} min wall-clock${C.reset}`);
  return result;
}

// ═══════════════════════════════════════════
// STEP 2: Get streaming token
// ═══════════════════════════════════════════
async function getToken() {
  console.log(`${C.cyan}[2/4] Getting streaming token...${C.reset}`);
  const res = await fetch(`${BASE_URL}/api/token`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.error || 'Token failed');
  console.log(`${C.green}  ✓ Token acquired${C.reset}`);
  return data.token;
}

// ═══════════════════════════════════════════
// STEP 3: Stream full audio and observe
// ═══════════════════════════════════════════
async function streamAndObserve(pcmBuffer, token) {
  return new Promise((resolve, reject) => {
    const audioDuration = pcmBuffer.length / SAMPLE_RATE / 2;
    console.log(`\n${C.cyan}[3/4] Opening WebSocket + streaming FULL ${(audioDuration / 60).toFixed(1)} min audio...${C.reset}`);
    console.log(`${C.dim}  Chunk: ${CHUNK_SIZE} samples @ ${FEED_INTERVAL_MS}ms (${SPEED_MULTIPLIER}x)${C.reset}`);
    console.log(`${C.dim}  Debounce: ${DEBOUNCE_MS}ms | Keyterms: ${DOMAIN_KEYTERMS.length}${C.reset}\n`);

    // Build WebSocket URL with keyterms
    const wsParams = new URLSearchParams({
      token,
      sample_rate: String(SAMPLE_RATE),
      speech_model: 'u3-rt-pro',
    });
    if (DOMAIN_KEYTERMS.length > 0) {
      wsParams.append('keyterms', JSON.stringify(DOMAIN_KEYTERMS));
    }

    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`);

    // ── State (mirrors useTranscription.js exactly) ──
    let accumulatedTranscript = '';
    let debounceTimer = null;
    let lastBullets = [];
    let cooldownUntil = 0;
    const history = [];

    // ── Telemetry ──
    const endOfTurnEvents = [];    // { time, transcript, audioSec }
    const copilotResults = [];
    let totalPartials = 0;
    let totalEndOfTurns = 0;
    let debounceFires = 0;
    let debounceSuppressions = 0;
    let gateBlocks = 0;
    let fragmentsPerFlush = [];
    let currentFragCount = 0;

    let sendInterval = null;
    let bytesSent = 0;
    const startTime = Date.now();

    function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1); }
    function audioSec() { return (bytesSent / SAMPLE_RATE / 2).toFixed(0); }

    // ── Debounce flush ──
    async function flushDebounce() {
      const fullQuestion = accumulatedTranscript.trim();
      const fragCount = currentFragCount;
      accumulatedTranscript = '';
      debounceTimer = null;
      currentFragCount = 0;

      if (!fullQuestion) return;
      fragmentsPerFlush.push(fragCount);
      debounceFires++;

      // Speaker gate
      const isCooldown = Date.now() < cooldownUntil;
      if (isCooldown) {
        gateBlocks++;
        debounceSuppressions++;
        console.log(`  ${C.dim}[${elapsed()}s|${audioSec()}s] GATE:COOLDOWN — skipped (${fragCount} frags)${C.reset}`);
        return;
      }

      console.log(`  ${C.yellow}[${elapsed()}s|${audioSec()}s] FLUSH → ${fragCount} frags: "${fullQuestion.slice(0, 100)}${fullQuestion.length > 100 ? '...' : ''}"${C.reset}`);

      // Fire copilot
      try {
        const t0 = Date.now();
        const res = await fetch(`${BASE_URL}/api/copilot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: fullQuestion,
            history: history.slice(-5),
            profilerState: null,
            clientTelemetry: { isRambling: false },
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '', buffer = '', ttft = null;

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
              if (event.token) {
                if (!ttft) ttft = Date.now() - t0;
                fullText += event.token;
              }
            } catch {}
          }
        }

        const totalMs = Date.now() - t0;
        const hasMotive = fullText.includes('[MOTIVE]');
        const hasMove = fullText.includes('[THE MOVE]') || fullText.includes('[MOVE]');
        const hasBait = fullText.includes('[BAIT]') || fullText.includes('[THE BAIT]');

        lastBullets = fullText.split('\n').filter(l => l.trim()).slice(0, 10);
        cooldownUntil = Date.now() + 3000;
        history.push({ question: fullQuestion, response: lastBullets, rawResponse: fullText });

        copilotResults.push({ question: fullQuestion.slice(0, 80), fragments: fragCount, ttft, totalMs, chars: fullText.length, hasMotive, hasMove, hasBait });
        console.log(`  ${C.green}  → TTFT=${ttft}ms Total=${totalMs}ms | ${fullText.length}ch | M:${hasMotive} MV:${hasMove} B:${hasBait}${C.reset}`);
      } catch (err) {
        copilotResults.push({ question: fullQuestion.slice(0, 80), fragments: fragCount, error: err.message });
        console.log(`  ${C.red}  → ERROR: ${err.message}${C.reset}`);
      }
    }

    let audioFeedOffset = 0;

    function startAudioFeed() {
      sendInterval = setInterval(() => {
        if (audioFeedOffset >= pcmBuffer.length) {
          clearInterval(sendInterval);
          sendInterval = null;
          console.log(`\n${C.cyan}  Audio feed complete. Waiting for final transcripts...${C.reset}`);
          setTimeout(() => {
            try { ws.send(JSON.stringify({ type: 'Terminate' })); } catch {}
          }, 10000); // Wait 10s for stragglers
          return;
        }
        const end = Math.min(audioFeedOffset + BYTES_PER_CHUNK, pcmBuffer.length);
        try {
          ws.send(pcmBuffer.slice(audioFeedOffset, end));
        } catch (e) {
          console.error(`${C.red}  Send error: ${e.message}${C.reset}`);
          clearInterval(sendInterval);
          return;
        }
        bytesSent += (end - audioFeedOffset);
        audioFeedOffset = end;

        // Progress every 5 min of audio
        const audioMin = bytesSent / SAMPLE_RATE / 2 / 60;
        if (audioMin > 0 && Math.floor(audioMin) !== Math.floor((bytesSent - (end - audioFeedOffset)) / SAMPLE_RATE / 2 / 60)) {
          process.stdout.write(`\r  ${C.dim}[progress] ${audioMin.toFixed(0)} min | ${totalEndOfTurns} eot | ${copilotResults.length} copilot${C.reset}        `);
        }
      }, FEED_INTERVAL_MS);
    }

    ws.on('open', () => {
      console.log(`${C.green}  ✓ WebSocket connected (keyterms: ${DOMAIN_KEYTERMS.length})${C.reset}`);
      console.log(`${C.dim}  Waiting for Begin message before feeding audio...${C.reset}`);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'Begin') {
          console.log(`${C.green}  ✓ STT session started — feeding audio now${C.reset}\n`);
          startAudioFeed();
        } else if (msg.type === 'Turn') {
          const transcript = msg.transcript || '';
          const endOfTurn = msg.end_of_turn || false;

          if (endOfTurn && transcript.trim()) {
            totalEndOfTurns++;
            const evt = { time: Date.now(), transcript, audioSec: audioSec() };
            endOfTurnEvents.push(evt);

            const gap = endOfTurnEvents.length > 1
              ? `+${((evt.time - endOfTurnEvents[endOfTurnEvents.length - 2].time) / 1000).toFixed(1)}s`
              : '';

            console.log(`  ${C.blue}[${elapsed()}s|${audioSec()}s]${C.reset} eot#${totalEndOfTurns} ${gap}: "${transcript.slice(0, 90)}${transcript.length > 90 ? '...' : ''}"`);

            // Debounce accumulator
            accumulatedTranscript = accumulatedTranscript ? `${accumulatedTranscript} ${transcript}` : transcript;
            currentFragCount++;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(flushDebounce, DEBOUNCE_MS);

          } else if (!endOfTurn && transcript.trim()) {
            totalPartials++;
            if (totalPartials % 20 === 0) {
              process.stdout.write(`\r  ${C.dim}[${elapsed()}s] partial#${totalPartials}: "${transcript.slice(-50)}"${C.reset}          `);
            }
          }
        } else if (msg.type === 'Termination') {
          console.log(`\n${C.yellow}  Session terminated${C.reset}`);
          setTimeout(() => ws.close(), DEBOUNCE_MS + 2000);
        }
      } catch (e) {
        console.error(`${C.red}  WS message parse error: ${e.message}${C.reset}`);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`${C.dim}  WebSocket closed: code=${code} reason=${reason?.toString() || 'none'}${C.reset}`);
      if (sendInterval) clearInterval(sendInterval);
      if (debounceTimer) { clearTimeout(debounceTimer); flushDebounce(); }

      // ══════ FULL REPORT ══════
      const wallClock = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log(`\n${'═'.repeat(70)}`);
      console.log(`${C.bold}FULL STREAMING E2E REPORT${C.reset}`);
      console.log(`Audio: ${(pcmBuffer.length / SAMPLE_RATE / 2 / 60).toFixed(1)} min | Wall: ${wallClock} min | Speed: ${SPEED_MULTIPLIER}x`);
      console.log(`${'═'.repeat(70)}`);

      console.log(`\n${C.bold}STT:${C.reset}`);
      console.log(`  Partials:       ${totalPartials}`);
      console.log(`  end_of_turn:    ${totalEndOfTurns}`);

      // Gap analysis
      if (endOfTurnEvents.length > 1) {
        const gaps = [];
        for (let i = 1; i < endOfTurnEvents.length; i++) {
          gaps.push(endOfTurnEvents[i].time - endOfTurnEvents[i - 1].time);
        }
        const shortGaps = gaps.filter(g => g < DEBOUNCE_MS);
        const longGaps = gaps.filter(g => g >= DEBOUNCE_MS);
        console.log(`\n${C.bold}Turn Gap Analysis:${C.reset}`);
        console.log(`  Rapid-fire (< ${DEBOUNCE_MS}ms): ${C.yellow}${shortGaps.length}${C.reset} ${shortGaps.length > 0 ? `(avg ${Math.round(shortGaps.reduce((a,b)=>a+b,0)/shortGaps.length)}ms)` : ''}`);
        console.log(`  Real pauses (≥ ${DEBOUNCE_MS}ms): ${longGaps.length} ${longGaps.length > 0 ? `(avg ${Math.round(longGaps.reduce((a,b)=>a+b,0)/longGaps.length)}ms)` : ''}`);
      }

      console.log(`\n${C.bold}Debounce:${C.reset}`);
      console.log(`  Flushes:        ${debounceFires}`);
      console.log(`  Gate blocks:    ${gateBlocks}`);
      if (fragmentsPerFlush.length > 0) {
        const avg = fragmentsPerFlush.reduce((a, b) => a + b, 0) / fragmentsPerFlush.length;
        const max = Math.max(...fragmentsPerFlush);
        const multi = fragmentsPerFlush.filter(f => f > 1).length;
        console.log(`  Avg frags/flush: ${avg.toFixed(1)}`);
        console.log(`  Max frags/flush: ${max}`);
        console.log(`  Multi-frag merges: ${multi} (debounce caught rapid-fire)`);
      }

      const successes = copilotResults.filter(r => !r.error);
      const errors = copilotResults.filter(r => r.error);
      console.log(`\n${C.bold}Copilot:${C.reset}`);
      console.log(`  Fires:          ${successes.length}`);
      console.log(`  Errors:         ${errors.length}`);
      if (successes.length > 0) {
        const ttfts = successes.map(r => r.ttft).filter(Boolean);
        const avgTTFT = ttfts.length > 0 ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : 0;
        const avgTotal = Math.round(successes.reduce((a, r) => a + r.totalMs, 0) / successes.length);
        const p95TTFT = ttfts.length > 0 ? ttfts.sort((a, b) => a - b)[Math.floor(ttfts.length * 0.95)] : 0;
        const motiveRate = successes.filter(r => r.hasMotive).length / successes.length * 100;
        const moveRate = successes.filter(r => r.hasMove).length / successes.length * 100;
        const baitRate = successes.filter(r => r.hasBait).length / successes.length * 100;

        console.log(`  Avg TTFT:       ${avgTTFT}ms ${avgTTFT > 3000 ? `${C.red}⚠ SLOW${C.reset}` : `${C.green}✓${C.reset}`}`);
        console.log(`  P95 TTFT:       ${p95TTFT}ms`);
        console.log(`  Avg Total:      ${avgTotal}ms`);
        console.log(`  MOTIVE:         ${motiveRate.toFixed(0)}%`);
        console.log(`  MOVE:           ${moveRate.toFixed(0)}%`);
        console.log(`  BAIT:           ${baitRate.toFixed(0)}%`);
      }

      // GAPS
      console.log(`\n${C.bold}${C.red}GAPS:${C.reset}`);
      let gapCount = 0;
      const rapidCount = endOfTurnEvents.length > 1 
        ? (() => { let c=0; for(let i=1;i<endOfTurnEvents.length;i++) if(endOfTurnEvents[i].time-endOfTurnEvents[i-1].time<DEBOUNCE_MS)c++; return c; })()
        : 0;
      const multiMerges = fragmentsPerFlush.filter(f => f > 1).length;
      
      if (totalEndOfTurns > 0 && debounceFires === 0) {
        console.log(`  ${C.red}⚠ CRITICAL: ${totalEndOfTurns} eot but 0 flushes — debounce broken${C.reset}`);
        gapCount++;
      }
      if (rapidCount > 0 && multiMerges === 0) {
        console.log(`  ${C.red}⚠ ${rapidCount} rapid-fire eots but 0 merges — debounce not catching splits${C.reset}`);
        gapCount++;
      }
      if (successes.length > 0) {
        const avgTTFT = successes.reduce((a, r) => a + (r.ttft || 0), 0) / successes.length;
        if (avgTTFT > 3000) {
          console.log(`  ${C.red}⚠ TTFT ${Math.round(avgTTFT)}ms — too slow${C.reset}`);
          gapCount++;
        }
      }
      if (errors.length > 0) {
        console.log(`  ${C.red}⚠ ${errors.length} copilot errors${C.reset}`);
        gapCount++;
      }
      if (gapCount === 0) {
        console.log(`  ${C.green}✓ No critical gaps${C.reset}`);
      }

      console.log(`\n${'═'.repeat(70)}\n`);
      resolve();
    });

    ws.on('error', (err) => {
      console.error(`${C.red}WebSocket error: ${err.message}${C.reset}`);
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════
async function main() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`${C.bold}STEALTH COPILOT — FULL STREAMING E2E (NO SANDBAGGING)${C.reset}`);
  console.log(`File:     ${MP3_PATH}`);
  console.log(`Duration: FULL FILE`);
  console.log(`Speed:    ${SPEED_MULTIPLIER}x realtime`);
  console.log(`Keyterms: ${DOMAIN_KEYTERMS.length}`);
  console.log(`Server:   ${BASE_URL}`);
  console.log(`${'═'.repeat(70)}\n`);

  const pcmBuffer = convertToPCM(MP3_PATH);
  const token = await getToken();
  await streamAndObserve(pcmBuffer, token);
}

main().catch(err => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
