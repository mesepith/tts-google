import express from "express";
import cors from "cors";
import compression from "compression";
import dotenv from "dotenv";
import { z } from "zod";
import textToSpeech from "@google-cloud/text-to-speech";

dotenv.config();

const PORT = Number(process.env.PORT || 7069);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:7068";
const VOICES_CACHE_TTL_SEC = Number(process.env.VOICES_CACHE_TTL_SEC || 3600);

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "256kb" }));
app.use(cors({ origin: CORS_ORIGIN, credentials: false }));

// ---- Google TTS client (ADC via GOOGLE_APPLICATION_CREDENTIALS) ----
const ttsClient = new textToSpeech.TextToSpeechClient();

// ---- Pricing (USD) per 1 million characters (see Google Cloud pricing page) ----
const PRICE_PER_1M_USD = {
  STANDARD: 4,
  WAVENET: 4,
  NEURAL2: 16,
  STUDIO: 160,
  CHIRP_HD: 30,
  POLYGLOT: 16,
  OTHER: 16, // safe default for "premium-ish"
};

function voiceTypeFromName(voiceName = "") {
  const n = voiceName;
  if (n.includes("-Studio-")) return "STUDIO";
  if (n.includes("-Neural2-")) return "NEURAL2";
  if (n.includes("-Wavenet-") || n.includes("-WaveNet-")) return "WAVENET";
  if (n.includes("-Standard-")) return "STANDARD";
  if (n.includes("Chirp3-HD") || n.includes("Chirp-HD") || n.includes("-Chirp-")) return "CHIRP_HD";
  if (n.includes("-Polyglot-")) return "POLYGLOT";
  return "OTHER";
}

function estimateCostUsd(voiceType, charCount) {
  const per1m = PRICE_PER_1M_USD[voiceType] ?? PRICE_PER_1M_USD.OTHER;
  return (per1m / 1_000_000) * charCount;
}

// ---- Voices cache ----
let voicesCache = {
  atMs: 0,
  voices: [],
};

async function listVoicesCached() {
  const now = Date.now();
  if (voicesCache.voices.length && now - voicesCache.atMs < VOICES_CACHE_TTL_SEC * 1000) {
    return voicesCache.voices;
  }
  const [resp] = await ttsClient.listVoices({});
  const voices = (resp.voices || []).map((v) => ({
    name: v.name,
    languageCodes: v.languageCodes || [],
    ssmlGender: v.ssmlGender || "SSML_VOICE_GENDER_UNSPECIFIED",
    naturalSampleRateHertz: v.naturalSampleRateHertz || null,
    voiceType: voiceTypeFromName(v.name),
  }));
  voicesCache = { atMs: now, voices };
  return voices;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/pricing", (req, res) => {
  res.json({
    currency: "USD",
    per1MCharacters: PRICE_PER_1M_USD,
    note: "Prices are estimates based on Google Cloud Text-to-Speech pricing page. Verify in your Cloud Console.",
  });
});

app.get("/api/voices", async (req, res) => {
  try {
    const voices = await listVoicesCached();
    // Build helper lists for UI
    const languages = Array.from(new Set(voices.flatMap((v) => v.languageCodes))).sort();
    const voiceTypes = Array.from(new Set(voices.map((v) => v.voiceType))).sort();

    res.json({
      voices,
      languages,
      voiceTypes,
      cache: {
        ttlSec: VOICES_CACHE_TTL_SEC,
        cachedAt: voicesCache.atMs ? new Date(voicesCache.atMs).toISOString() : null,
        count: voices.length,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list voices", details: String(e?.message || e) });
  }
});

const SynthesizeSchema = z.object({
  inputType: z.enum(["text", "ssml"]).default("text"),
  text: z.string().min(1).max(4000),
  voiceName: z.string().min(1),
  // optional override (voiceName alone is usually enough)
  languageCode: z.string().optional(),
  audioEncoding: z.enum(["MP3", "OGG_OPUS", "LINEAR16", "MULAW"]).default("MP3"),
  speakingRate: z.number().min(0.25).max(4.0).optional(),
  pitch: z.number().min(-20).max(20).optional(),
  volumeGainDb: z.number().min(-96.0).max(16.0).optional(),
});

app.post("/api/synthesize", async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const clientStarted = Date.now();

  try {
    const parsed = SynthesizeSchema.parse(req.body);
    const voices = await listVoicesCached();
    const voice = voices.find((v) => v.name === parsed.voiceName);

    if (!voice) {
      return res.status(400).json({ error: "Unknown voiceName. Fetch /api/voices and pick one from the list." });
    }

    const voiceType = voice.voiceType;
    const warnings = [];

    // Chirp 3: HD limitations: no SSML and no speakingRate/pitch (per docs).
    // We'll enforce here so the UI never sends invalid params and API errors are minimized.
    let inputType = parsed.inputType;
    let speakingRate = parsed.speakingRate;
    let pitch = parsed.pitch;

    if (voiceType === "CHIRP_HD") {
      if (inputType === "ssml") {
        warnings.push("Chirp 3: HD voices do not support SSML. Falling back to plain text.");
        inputType = "text";
      }
      if (speakingRate !== undefined) {
        warnings.push("Chirp 3: HD voices do not support speakingRate. Ignoring.");
        speakingRate = undefined;
      }
      if (pitch !== undefined) {
        warnings.push("Chirp 3: HD voices do not support pitch. Ignoring.");
        pitch = undefined;
      }
      if (parsed.audioEncoding === "MULAW") {
        // ALAW is explicitly mentioned as unsupported; MU-LAW is generally supported, but we keep MP3 default anyway.
      }
    }

    // Character count for estimation (billing counts SSML tags too, except <mark>, per pricing docs).
    const charCount = parsed.text.length;

    const request = {
      input: inputType === "ssml" ? { ssml: parsed.text } : { text: parsed.text },
      voice: {
        name: parsed.voiceName,
        languageCode: parsed.languageCode || (voice.languageCodes?.[0] ?? undefined),
      },
      audioConfig: {
        audioEncoding: parsed.audioEncoding,
        ...(speakingRate !== undefined ? { speakingRate } : {}),
        ...(pitch !== undefined ? { pitch } : {}),
        ...(parsed.volumeGainDb !== undefined ? { volumeGainDb: parsed.volumeGainDb } : {}),
      },
    };

    const t0 = process.hrtime.bigint();
    const [response] = await ttsClient.synthesizeSpeech(request);
    const t1 = process.hrtime.bigint();

    const audioContent = response.audioContent?.toString("base64") ?? "";
    if (!audioContent) {
      return res.status(500).json({ error: "No audioContent returned by Google TTS." });
    }

    const ttsMs = Number(t1 - t0) / 1e6;
    const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const estimatedCostUsd = estimateCostUsd(voiceType, charCount);

    const mimeType =
      parsed.audioEncoding === "MP3"
        ? "audio/mpeg"
        : parsed.audioEncoding === "OGG_OPUS"
          ? "audio/ogg"
          : parsed.audioEncoding === "LINEAR16"
            ? "audio/wav" // note: LINEAR16 is raw PCM in a container; many players treat as WAV if headers exist. Google returns bytes; browsers may still play via AudioContext.
            : "audio/basic";

    res.json({
      audio: {
        base64: audioContent,
        mimeType,
        encoding: parsed.audioEncoding,
      },
      voice: {
        name: voice.name,
        voiceType,
        ssmlGender: voice.ssmlGender,
        languageCodes: voice.languageCodes,
        naturalSampleRateHertz: voice.naturalSampleRateHertz,
      },
      metrics: {
        server: {
          ttsMs: Math.round(ttsMs),
          totalMs: Math.round(totalMs),
          startedAtIso: new Date(clientStarted).toISOString(),
        },
        input: {
          charCount,
          inputType,
        },
        billingEstimate: {
          currency: "USD",
          estimatedCostUsd,
          per1MCharactersUsd: PRICE_PER_1M_USD[voiceType] ?? PRICE_PER_1M_USD.OTHER,
        },
      },
      warnings,
    });
  } catch (e) {
    const msg = e?.errors ? e.errors : String(e?.message || e);
    console.error(e);
    res.status(400).json({ error: "Bad request", details: msg });
  }
});

app.listen(PORT, () => {
  console.log(`✅ tts-google backend listening on http://127.0.0.1:${PORT}`);
});
