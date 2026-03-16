/**
 * /api/tts — ElevenLabs Text-to-Speech Proxy
 * ============================================
 * Streams synthesised audio from ElevenLabs back to the browser.
 * The ELEVENLABS_API_KEY never leaves the server.
 *
 * Usage:
 *   POST /api/tts  { "text": "Hello world", "voiceId": "optional-override" }
 *   → 200  audio/mpeg  (streamed MP3)
 */

// ElevenLabs defaults
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah" — premade, multilingual
const MODEL_ID = "eleven_multilingual_v2";         // Best multilingual model
const OUTPUT_FORMAT = "mp3_22050_32";              // Small + fast + browser-native

export async function POST(request) {
  try {
    const { text, voiceId } = await request.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return Response.json({ error: "Missing or empty 'text' field" }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "ELEVENLABS_API_KEY not set in environment" },
        { status: 500 }
      );
    }

    const voice = voiceId || DEFAULT_VOICE_ID;

    // ---- Call ElevenLabs Streaming TTS ----
    const elevenLabsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${OUTPUT_FORMAT}&optimize_streaming_latency=3`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: MODEL_ID,
        }),
      }
    );

    if (!elevenLabsRes.ok) {
      const errBody = await elevenLabsRes.text();
      console.error("[/api/tts] ElevenLabs error:", elevenLabsRes.status, errBody);
      return Response.json(
        { error: "ElevenLabs API error", status: elevenLabsRes.status, detail: errBody },
        { status: 502 }
      );
    }

    // ---- Stream the audio bytes straight through to the browser ----
    return new Response(elevenLabsRes.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    console.error("[/api/tts] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
