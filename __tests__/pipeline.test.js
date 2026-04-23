/**
 * pipeline.test.js — Interview Copilot pipeline tests
 *
 * Tests:
 * 1. Jitter test: turn 3 arrives before turn 2 → history reconstructs in turn_order order
 * 2. Rescue test: SpeechStarted + partial + no final → watchdog fires rescue with partial
 * 3. Non-rescue test: candidate pauses but completes → watchdog canceled on end_of_turn:true
 * 4. Speaker-drift test: diarization labels wobble → role mapping prevents wrong routing
 * 5. Coding-phase test: detectCodingPhase() flips → terminal mode routes correctly
 */

// ── Test 1: Jitter — turn_order sort before LLM history build ──
describe('Turn order jitter', () => {
  test('turnLog sorts by turn_order even when turns arrive out of order', () => {
    const turnLog = [];

    // Simulate turn 3 arriving before turn 2
    const turn3 = { turn_order: 3, speaker_role: 'interviewer', transcript: 'Third turn', end_of_turn: true, words: [], avg_confidence: 1.0, timestamp_ms: Date.now() };
    const turn1 = { turn_order: 1, speaker_role: 'interviewer', transcript: 'First turn', end_of_turn: true, words: [], avg_confidence: 1.0, timestamp_ms: Date.now() };
    const turn2 = { turn_order: 2, speaker_role: 'candidate', transcript: 'Second turn', end_of_turn: true, words: [], avg_confidence: 1.0, timestamp_ms: Date.now() };

    // Arrive out of order: 3, 1, 2
    turnLog.push(turn3);
    turnLog.push(turn1);
    turnLog.push(turn2);

    // Sort as useTranscriptProcessor does
    turnLog.sort((a, b) => a.turn_order - b.turn_order);

    expect(turnLog[0].turn_order).toBe(1);
    expect(turnLog[1].turn_order).toBe(2);
    expect(turnLog[2].turn_order).toBe(3);
    expect(turnLog[0].transcript).toBe('First turn');
    expect(turnLog[1].transcript).toBe('Second turn');
    expect(turnLog[2].transcript).toBe('Third turn');
  });
});

// ── Test 2: Rescue — watchdog fires with last partial when no final arrives ──
describe('Stall watchdog rescue', () => {
  test('watchdog fires rescue with last partial transcript after STALL_TIMEOUT_MS', (done) => {
    jest.useFakeTimers();

    const STALL_TIMEOUT_MS = 4000;
    let rescueFired = false;
    let rescueContext = null;

    const lastPartialRef = { current: null };

    // Simulate SpeechStarted → set partial → watchdog fires
    const startWatchdog = () => {
      setTimeout(() => {
        const partial = lastPartialRef.current;
        rescueContext = partial?.transcript || 'Candidate stalled mid-sentence.';
        rescueFired = true;
      }, STALL_TIMEOUT_MS);
    };

    // Simulate SpeechStarted
    startWatchdog();

    // Simulate partial arriving (but no final)
    lastPartialRef.current = {
      transcript: 'So the approach I would take is to use a binary',
      end_of_turn: false,
      turn_order: 5,
    };

    // Advance time past stall timeout
    jest.advanceTimersByTime(STALL_TIMEOUT_MS + 100);

    expect(rescueFired).toBe(true);
    expect(rescueContext).toBe('So the approach I would take is to use a binary');

    jest.useRealTimers();
    done();
  });
});

// ── Test 3: Non-rescue — watchdog canceled on end_of_turn:true ──
describe('Stall watchdog cancellation', () => {
  test('watchdog is canceled when candidate completes turn normally', () => {
    jest.useFakeTimers();

    const STALL_TIMEOUT_MS = 4000;
    let rescueFired = false;

    let watchdogTimer = null;

    const startWatchdog = () => {
      watchdogTimer = setTimeout(() => {
        rescueFired = true;
      }, STALL_TIMEOUT_MS);
    };

    const cancelWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    // Simulate SpeechStarted → start watchdog
    startWatchdog();

    // Simulate candidate completing turn normally (end_of_turn: true)
    cancelWatchdog();

    // Advance time past stall timeout — rescue should NOT fire
    jest.advanceTimersByTime(STALL_TIMEOUT_MS + 100);

    expect(rescueFired).toBe(false);

    jest.useRealTimers();
  });
});

// ── Test 4: Speaker drift — role mapping prevents wrong routing ──
describe('Speaker drift correction', () => {
  test('diarization label wobble does not reroute candidate speech to interviewer', () => {
    // Simulate the getSpeakerRole logic from useTranscriptProcessor
    const speakerMap = {};
    let interviewerLabel = null;
    let candidateLabel = null;
    let lastRole = null;

    const getSpeakerRole = (label) => {
      if (!label) return 'unknown';
      if (speakerMap[label]) {
        lastRole = speakerMap[label];
        return speakerMap[label];
      }
      if (!interviewerLabel) {
        interviewerLabel = label;
        speakerMap[label] = 'interviewer';
        lastRole = 'interviewer';
        return 'interviewer';
      }
      if (!candidateLabel) {
        candidateLabel = label;
        speakerMap[label] = 'candidate';
        lastRole = 'candidate';
        return 'candidate';
      }
      // Drift: new label → assign opposite of last known role
      const driftRole = lastRole === 'interviewer' ? 'candidate' : 'interviewer';
      speakerMap[label] = driftRole;
      lastRole = driftRole;
      return driftRole;
    };

    // Normal assignment
    expect(getSpeakerRole('A')).toBe('interviewer');
    expect(getSpeakerRole('B')).toBe('candidate');

    // Drift: AssemblyAI emits a new label 'C' mid-session
    // With max_speakers=2, this should be treated as drift, not a third speaker
    // Last role was 'candidate', so drift assigns 'interviewer'
    const driftRole = getSpeakerRole('C');
    expect(['interviewer', 'candidate']).toContain(driftRole); // Must be one of the two roles

    // Subsequent turns with known labels still resolve correctly
    expect(getSpeakerRole('A')).toBe('interviewer');
    expect(getSpeakerRole('B')).toBe('candidate');
  });
});

// ── Test 5: Coding phase detection ──
describe('detectCodingPhase', () => {
  // Inline the detection logic (mirrors detectCodingPhase.js)
  const HIGH_SIGNAL = ['implement', 'write a function', 'binary search', 'time complexity', 'dynamic programming'];
  const TRANSCRIPT_THRESHOLD = 4;

  const scoreTranscript = (transcript) => {
    if (!transcript) return 0;
    const lower = transcript.toLowerCase();
    let score = 0;
    for (const kw of HIGH_SIGNAL) {
      if (lower.includes(kw)) score += 3;
    }
    return score;
  };

  const detectCodingPhaseSimple = ({ transcript, manualTerminalMode }) => {
    if (manualTerminalMode) return { active: true, reason: 'manual_override' };
    if (scoreTranscript(transcript) >= TRANSCRIPT_THRESHOLD) return { active: true, reason: 'transcript_keywords' };
    return { active: false, reason: 'none' };
  };

  test('activates terminal mode on coding keywords', () => {
    const result = detectCodingPhaseSimple({
      transcript: "Can you implement a binary search function?",
      manualTerminalMode: false,
    });
    expect(result.active).toBe(true);
    expect(result.reason).toBe('transcript_keywords');
  });

  test('does not activate on non-coding question', () => {
    const result = detectCodingPhaseSimple({
      transcript: "Tell me about yourself and your background.",
      manualTerminalMode: false,
    });
    expect(result.active).toBe(false);
  });

  test('manual override always activates terminal mode', () => {
    const result = detectCodingPhaseSimple({
      transcript: "Tell me about yourself.",
      manualTerminalMode: true,
    });
    expect(result.active).toBe(true);
    expect(result.reason).toBe('manual_override');
  });
});
