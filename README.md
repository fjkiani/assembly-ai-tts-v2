# Interview Copilot

Real-time AI copilot for technical interviews. Transcribes audio via AssemblyAI Universal-3 streaming, generates tactical coaching via Cohere/Groq LLMs, and displays a structured HUD overlay.

## Gateway document (read this first)

**Cursor agents, contractors, and anyone touching backend or orchestration:** start here — not only this README.

| Doc | Purpose |
|-----|---------|
| [`docs/BACKEND_AGENTIC_FRAMEWORK_ROADMAP.mdc`](docs/BACKEND_AGENTIC_FRAMEWORK_ROADMAP.mdc) | **Architecture contract**: current API routes, why the single-stream LLM pipeline hits a ceiling, failure modes, gaps vs sales/medical frameworks (MEDDPICC, SPIN), and the phased plan for multi-agent / multi-model work. |

That file is the **single entry point** for extending `app/api/**`, `lib/**`, prompts, and future framework engines.

## Features

- **Real-time STT** — AssemblyAI Universal-3 Pro streaming (WebSocket)
- **Tactical HUD** — LLM generates structured coaching: `[MOTIVE]`, `[DELIVERY]`, `[THE MOVE]`, `[THE BAIT]`, `[THE DIAGNOSTIC]`
- **Terminal Mode** — Code-focused HUD: `[ALGORITHM]`, `[COMPLEXITY]`, `[EDGE CASES]`, `[THE CODE]` with 2048 token limit
- **Capability Control Panel** — 6 toggleable modes (Terminal, Clipboard, Stealth, Keyterms, Profiler, Auto-Fire)
- **Bookend Memory** — Preserves first 2 turns (problem statement) + last 4 turns for LLM context
- **Clipboard Poller (Shadow IDE)** — Captures code from Cmd+C to provide IDE context to the LLM
- **WebSocket Auto-Reconnect** — Exponential backoff (3 attempts) if connection drops
- **"Burn It" Hotkey** — Backspace clears active context + removes poisoned history
- **Panic Cover** — ESC shows fake Swagger API docs for screen-share safety
- **Background Profiler** — 60s behavioral analysis loop (power dynamics, conversation phase tracking)
- **Follow-Up Generator** — SSE-streamed follow-up questions based on interview history

## Quick Start

```bash
# 1. Clone
git clone https://github.com/fjkiani/interview-helper.git
cd interview-helper

# 2. Install
npm install

# 3. Configure
cp .env.example .env.local
# Edit .env.local with your API keys

# 4. Run
npm run dev
# Open http://localhost:3000
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `SPACE` | Hold/release copilot |
| `ESC` | Toggle cover page (fake Swagger docs) |
| `Backspace` | "Burn It" — flush active context |
| `Ctrl+Shift+S` | Toggle auto-stealth |

## Capability Panel

Click `⚙ Modes` to toggle:

| Toggle | Default | Description |
|--------|---------|-------------|
| 💻 Terminal | OFF | Code-focused HUD + 2048 tokens |
| 📋 Clipboard | ON | Capture code from Cmd+C |
| 👁 Stealth | ON | Auto-cover on window blur |
| 🔑 Keyterms | ON | Domain vocabulary for STT (locked during stream) |
| 🧠 Profiler | ON | Background behavioral analysis |
| 🔔 Auto-Fire | ON | Auto-trigger copilot on silence |

## Audio Setup (for hearing interviewer)

### Option A: Zoom in Chrome
Run Zoom in a Chrome tab → select that tab in the share dialog → enable "Also share tab audio"

### Option B: BlackHole (bulletproof)
```bash
brew install blackhole-2ch
```
1. Open Audio MIDI Setup → Create **Multi-Output Device** (Built-in Output + BlackHole 2ch)
2. Create **Aggregate Device** (Built-in Mic + BlackHole 2ch)
3. Set Multi-Output as system output, select Aggregate as Chrome mic

## Tech Stack

- **Frontend:** Next.js 16 + React 19
- **STT:** AssemblyAI Universal-3 Pro (WebSocket streaming)
- **LLM:** Cohere Command-A / Groq Llama 3.3 70B (SSE streaming)
- **Styling:** CSS Modules + JetBrains Mono

## Environment Variables

See `.env.example` for required keys.
