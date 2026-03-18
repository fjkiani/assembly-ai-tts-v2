/**
 * audioCapture — Browser audio capture (mic + system audio)
 * 
 * Handles getUserMedia (mic) and getDisplayMedia (system audio from Zoom/YouTube).
 * Mixes both via WebAudio ChannelMergerNode into a single stream.
 * 
 * Browser-only (uses navigator.mediaDevices).
 */

/**
 * Capture mic audio. Returns the MediaStream.
 */
export async function captureMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
}

/**
 * Capture system audio via getDisplayMedia.
 * Returns { stream, audioStream } or { stream: null, audioStream: null } if user cancels.
 */
export async function captureSystemAudio() {
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    // Kill video track immediately — only need audio
    displayStream.getVideoTracks().forEach(t => t.stop());

    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const audioStream = new MediaStream(audioTracks);
      console.log('[audio] System audio captured:', audioTracks[0].label);
      return { stream: displayStream, audioStream };
    }

    console.warn('[audio] No system audio — user may not have checked "Share audio"');
    return { stream: displayStream, audioStream: null };
  } catch (err) {
    console.warn('[audio] System audio not available:', err.message);
    return { stream: null, audioStream: null };
  }
}

/**
 * Create WebAudio processing pipeline that mixes mic + system audio
 * and sends PCM16 frames to a WebSocket.
 * 
 * @param {Object} opts
 * @param {MediaStream} opts.micStream
 * @param {MediaStream|null} opts.systemAudioStream
 * @param {WebSocket} opts.ws
 * @returns {{ audioContext: AudioContext, processor: ScriptProcessorNode, cleanup: () => void }}
 */
export function createAudioPipeline({ micStream, systemAudioStream, ws }) {
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const micSource = audioContext.createMediaStreamSource(micStream);

  // Mutable binding — allows updateWs() to redirect audio frames during reconnect
  let activeWs = ws;

  let finalSource;
  if (systemAudioStream) {
    const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
    const merger = audioContext.createChannelMerger(2);
    micSource.connect(merger, 0, 0);
    systemSource.connect(merger, 0, 1);
    finalSource = merger;
    console.log('[audio] Mixed mode: mic + system audio');
  } else {
    finalSource = micSource;
    console.log('[audio] Mic-only mode');
  }

  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    if (activeWs.readyState !== WebSocket.OPEN) return;
    const inputData = e.inputBuffer.getChannelData(0);
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    activeWs.send(pcm16.buffer);
  };

  finalSource.connect(processor);
  processor.connect(audioContext.destination);

  const cleanup = () => {
    try { processor.disconnect(); } catch {}
    try { audioContext.close(); } catch {}
  };

  // BS1: Allow swapping WS target during reconnect without tearing down AudioContext
  const updateWs = (newWs) => {
    activeWs = newWs;
    console.log('[audio] WebSocket target updated for reconnect');
  };

  return { audioContext, processor, cleanup, updateWs };
}

/**
 * Stop all tracks on a MediaStream.
 */
export function stopMediaStream(stream) {
  if (!stream) return;
  try { stream.getTracks().forEach(t => t.stop()); } catch {}
}
