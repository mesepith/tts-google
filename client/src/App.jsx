import { useEffect, useMemo, useRef, useState } from "react";

function voiceTypePretty(t) {
  if (t === "CHIRP_HD") return "Chirp 3: HD";
  if (t === "WAVENET") return "WaveNet";
  if (t === "NEURAL2") return "Neural2";
  if (t === "STUDIO") return "Studio";
  if (t === "STANDARD") return "Standard";
  if (t === "POLYGLOT") return "Polyglot";
  return t || "Other";
}

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n === 0) return "$0";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(6)}`;
}

export default function App() {
  const audioRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState("");
  const [error, setError] = useState("");

  const [voices, setVoices] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [voiceTypes, setVoiceTypes] = useState([]);

  const [language, setLanguage] = useState("en-US");
  const [voiceType, setVoiceType] = useState("CHIRP_HD");
  const [voiceName, setVoiceName] = useState("");

  const [audioEncoding, setAudioEncoding] = useState("MP3");
  const [inputType, setInputType] = useState("text");
  const [speakingRate, setSpeakingRate] = useState(1.0);
  const [pitch, setPitch] = useState(0);

  const [text, setText] = useState("Hello! This is a quick test of Google Text-to-Speech.");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const [audioDuration, setAudioDuration] = useState(null);

  const isChirp = voiceType === "CHIRP_HD";

  useEffect(() => {
    (async () => {
      try {
        setBootError("");
        const res = await fetch("/api/voices");
        if (!res.ok) throw new Error(`voices failed: ${res.status}`);
        const data = await res.json();
        setVoices(data.voices || []);
        setLanguages(data.languages || []);
        setVoiceTypes(data.voiceTypes || []);

        // Try to pick sensible defaults (Chirp HD if available, else Neural2)
        const hasChirp = (data.voices || []).some((v) => v.voiceType === "CHIRP_HD");
        const defaultType = hasChirp ? "CHIRP_HD" : ((data.voiceTypes || []).includes("NEURAL2") ? "NEURAL2" : (data.voiceTypes || [])[0]);
        setVoiceType(defaultType || "NEURAL2");

        // pick a default language & voice
        const defaultLang = (data.languages || []).includes("en-US") ? "en-US" : (data.languages || [])[0];
        setLanguage(defaultLang || "en-US");
      } catch (e) {
        setBootError(String(e?.message || e));
      }
    })();
  }, []);

  const filteredVoices = useMemo(() => {
    return voices
      .filter((v) => (language ? (v.languageCodes || []).includes(language) : true))
      .filter((v) => (voiceType ? v.voiceType === voiceType : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [voices, language, voiceType]);

  useEffect(() => {
    // If current voiceName not in list, pick first
    if (!filteredVoices.length) return;
    const exists = filteredVoices.some((v) => v.name === voiceName);
    if (!exists) setVoiceName(filteredVoices[0].name);
  }, [filteredVoices, voiceName]);

  useEffect(() => {
    // Chirp doesn't support SSML / speakingRate / pitch
    if (isChirp) {
      setInputType("text");
      setSpeakingRate(1.0);
      setPitch(0);
    }
  }, [isChirp]);

  const canGenerate = useMemo(() => {
    return !loading && text.trim() && voiceName;
  }, [loading, text, voiceName]);

  function play() {
    const a = audioRef.current;
    if (!a) return;
    a.play().catch(() => {});
  }
  function pause() {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
  }
  function stop() {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
  }

  async function generate() {
    setError("");
    setAudioDuration(null);

    const payload = {
      inputType,
      text: text.trim(),
      voiceName,
      languageCode: language,
      audioEncoding,
      ...(isChirp ? {} : { speakingRate: Number(speakingRate), pitch: Number(pitch) }),
    };

    const t0 = performance.now();
    setLoading(true);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const t1 = performance.now();
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details ? JSON.stringify(data.details) : (data?.error || `HTTP ${res.status}`));

      const audioSrc = `data:${data.audio.mimeType};base64,${data.audio.base64}`;
      const entry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        audioSrc,
        data,
        client: {
          totalMs: Math.round(t1 - t0),
        },
      };

      setResult(entry);
      setHistory((h) => [entry, ...h].slice(0, 20));

      // Set and autoplay
      requestAnimationFrame(() => {
        if (!audioRef.current) return;
        audioRef.current.src = audioSrc;
        audioRef.current.load();
        audioRef.current.play().catch(() => {});
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    // Enter to submit (Shift+Enter newline)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canGenerate) generate();
    }
  }

  return (
    <div className="container">
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Google TTS Tester</div>
          <div className="small">Compare Studio / Neural2 / WaveNet / Standard / Chirp 3: HD voices quickly.</div>
        </div>
        <div className="badge">Backend: <span className="mono">/api</span></div>
      </div>

      {bootError ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="error"><b>Backend not reachable.</b> {bootError}</div>
          <div className="small" style={{ marginTop: 8 }}>
            Make sure backend is running on port 7069 and Vite proxy is enabled.
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row cols3">
              <div>
                <label>Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <div>
                <label>Voice type (model)</label>
                <select value={voiceType} onChange={(e) => setVoiceType(e.target.value)}>
                  {voiceTypes.map((t) => (
                    <option key={t} value={t}>{voiceTypePretty(t)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label>Voice</label>
                <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                  {filteredVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.ssmlGender})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row cols3" style={{ marginTop: 12 }}>
              <div>
                <label>Audio encoding</label>
                <select value={audioEncoding} onChange={(e) => setAudioEncoding(e.target.value)}>
                  <option value="MP3">MP3</option>
                  <option value="OGG_OPUS">OGG_OPUS</option>
                  <option value="LINEAR16">LINEAR16</option>
                  <option value="MULAW">MULAW</option>
                </select>
              </div>

              <div>
                <label>Input type</label>
                <select value={inputType} onChange={(e) => setInputType(e.target.value)} disabled={isChirp}>
                  <option value="text">Text</option>
                  <option value="ssml">SSML</option>
                </select>
                {isChirp && <div className="small">Chirp 3: HD doesn&apos;t support SSML.</div>}
              </div>

              <div>
                <label>Speaking rate / Pitch</label>
                <div className="hstack">
                  <input
                    type="number"
                    step="0.05"
                    min="0.25"
                    max="4"
                    value={speakingRate}
                    disabled={isChirp}
                    onChange={(e) => setSpeakingRate(e.target.value)}
                  />
                  <input
                    type="number"
                    step="1"
                    min="-20"
                    max="20"
                    value={pitch}
                    disabled={isChirp}
                    onChange={(e) => setPitch(e.target.value)}
                  />
                </div>
                <div className="small">{isChirp ? "Disabled for Chirp 3: HD." : "Left: rate (0.25–4), Right: pitch (-20..20)."}</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>Text (Enter = Generate, Shift+Enter = newline)</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
            </div>

            <div className="hstack" style={{ marginTop: 12 }}>
              <button disabled={!canGenerate} onClick={generate}>
                {loading ? "Generating..." : "Generate"}
              </button>
              <button className="secondary" onClick={() => setText("")} disabled={loading}>Clear</button>
              {error && <div className="error">{error}</div>}
            </div>

            {result?.data?.warnings?.length ? (
              <div className="small" style={{ marginTop: 10 }}>
                {result.data.warnings.map((w, idx) => (
                  <div key={idx} className="badge" style={{ marginRight: 6, marginTop: 6 }}>{w}</div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Output</div>

            {result ? (
              <>
                <audio
                  ref={audioRef}
                  controls
                  autoPlay
                  onLoadedMetadata={() => {
                    const a = audioRef.current;
                    if (!a) return;
                    if (!Number.isNaN(a.duration) && Number.isFinite(a.duration)) {
                      setAudioDuration(a.duration);
                    }
                  }}
                />

                <div className="hstack" style={{ marginTop: 10 }}>
                  <button onClick={play} className="secondary">Play</button>
                  <button onClick={pause} className="secondary">Pause</button>
                  <button onClick={stop} className="danger">Stop</button>
                </div>

                <hr />

                <table className="table">
                  <tbody>
                    <tr><td>Voice</td><td className="mono">{result.data.voice.name}</td></tr>
                    <tr><td>Voice type</td><td><span className="badge">{voiceTypePretty(result.data.voice.voiceType)}</span></td></tr>
                    <tr><td>Language(s)</td><td className="mono">{(result.data.voice.languageCodes || []).join(", ")}</td></tr>
                    <tr><td>Input chars</td><td className="mono">{result.data.metrics.input.charCount}</td></tr>
                    <tr><td>Backend TTS time</td><td className="mono">{result.data.metrics.server.ttsMs} ms</td></tr>
                    <tr><td>Total backend time</td><td className="mono">{result.data.metrics.server.totalMs} ms</td></tr>
                    <tr><td>Total client time</td><td className="mono">{result.client.totalMs} ms</td></tr>
                    <tr><td>Estimated cost</td><td className="mono">{formatUsd(result.data.metrics.billingEstimate.estimatedCostUsd)}</td></tr>
                    <tr><td>Encoding</td><td className="mono">{result.data.audio.encoding}</td></tr>
                    <tr><td>Duration (browser)</td><td className="mono">{audioDuration ? `${audioDuration.toFixed(2)} s` : "-"}</td></tr>
                  </tbody>
                </table>
              </>
            ) : (
              <div className="small">Generate audio to see the player and metrics here.</div>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="hstack" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 800 }}>History (last 20)</div>
              <div className="small">Click an item to load it into the player.</div>
            </div>

            {history.length === 0 ? (
              <div className="small" style={{ marginTop: 8 }}>No history yet.</div>
            ) : (
              <div style={{ marginTop: 10 }}>
                {history.map((h) => (
                  <div key={h.id} className="hstack" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <div>
                      <div className="mono">{h.data.voice.name}</div>
                      <div className="small">
                        {voiceTypePretty(h.data.voice.voiceType)} • {h.data.metrics.server.ttsMs} ms • {h.data.metrics.input.charCount} chars • {formatUsd(h.data.metrics.billingEstimate.estimatedCostUsd)}
                      </div>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        setResult(h);
                        requestAnimationFrame(() => {
                          if (!audioRef.current) return;
                          audioRef.current.src = h.audioSrc;
                          audioRef.current.load();
                          audioRef.current.play().catch(() => {});
                        });
                      }}
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
