import { useState, useEffect, useRef, useCallback } from "react";

/* ────────────────────────────────────────────────────────────
   순수 로직 (wordlab-logic.mjs 원본을 인라인. 테스트 29개 통과)
   ──────────────────────────────────────────────────────────── */

function normalize(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}
function isCorrect(input, answer) {
  const a = normalize(answer);
  if (!a) return false;
  return normalize(input) === a;
}
function commonPrefixLen(input, answer) {
  const x = normalize(input), y = normalize(answer);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}
function hintMask(word) {
  const chars = [...String(word ?? "")];
  if (chars.length === 0) return "";
  return chars.map((c, i) => {
    if (c === " " || c === "-") return c;
    if (i === 0 || i === chars.length - 1) return c;
    if (i % 3 === 0) return c;
    return "_";
  }).join(" ");
}
function makeRng(seed) {
  let t = (Number(seed) || 1) >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function pickDistractors(words, correctWord, count, rng) {
  const pool = words.filter((w) => w.word !== correctWord.word);
  return shuffle(pool, rng).slice(0, count);
}
function buildQuiz(words, opts = {}) {
  const { types = ["spell", "listen", "meaning"], seed = 1 } = opts;
  if (!Array.isArray(words) || words.length === 0) return [];
  const rng = makeRng(seed);
  const ordered = shuffle(words, rng);
  return ordered.map((w, i) => {
    const type = types[i % types.length];
    const q = {
      id: w.word, type, word: w.word, meaning: w.meaning,
      chunks: Array.isArray(w.chunks) && w.chunks.length ? w.chunks : [w.word],
      hint: hintMask(w.word),
    };
    if (type === "meaning") {
      const distractors = pickDistractors(words, w, 3, rng);
      q.options = shuffle([w, ...distractors].map((d) => d.meaning), rng);
    }
    return q;
  });
}
function gradeAnswer(question, raw) {
  if (question.type === "meaning") {
    return { correct: String(raw ?? "").trim() === String(question.meaning).trim(), matched: 0 };
  }
  const ok = isCorrect(raw, question.word);
  return { correct: ok, matched: ok ? 0 : commonPrefixLen(raw, question.word) };
}
function summarize(results) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  return {
    total, correct,
    wrong: results.filter((r) => !r.correct).map((r) => r.word),
    percent: total === 0 ? 0 : Math.round((correct / total) * 100),
  };
}
function collectWrong(words, results) {
  const wrongSet = new Set(results.filter((r) => !r.correct).map((r) => r.word));
  return words.filter((w) => wrongSet.has(w.word));
}
function extractJson(text) {
  const cleaned = String(text ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}
function sanitizeWords(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const item of raw) {
    const word = String(item?.word ?? "").trim();
    const meaning = String(item?.meaning ?? "").trim();
    if (!word || !meaning) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let chunks = Array.isArray(item?.chunks) ? item.chunks.map((c) => String(c).trim()).filter(Boolean) : [];
    if (chunks.join("").toLowerCase().replace(/\s/g, "") !== key.replace(/\s/g, "")) chunks = [word];
    out.push({ word, meaning, chunks });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────
   소리 (브라우저 음성 합성)
   ──────────────────────────────────────────────────────────── */

function speak(text, rate = 0.8) {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "en-US";
    u.rate = rate;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => /en[-_]US/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

/* ────────────────────────────────────────────────────────────
   API
   ──────────────────────────────────────────────────────────── */

async function callClaude(body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, ...body }),
  });
  if (!res.ok) throw new Error("서버가 응답하지 않았어요 (" + res.status + ")");
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

async function extractFromImage(base64, mime) {
  const text = await callClaude({
    system: "You read photos of Korean-English vocabulary books and return JSON only. No prose, no markdown fences.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
        { type: "text", text:
          '이 페이지의 영단어 항목을 모두 뽑아줘.\n' +
          'word: 영어 표제어\n' +
          'meaning: 책에 적힌 한국어 뜻 (짧게, 품사 표시는 빼고)\n' +
          'chunks: 발음 덩어리로 나눈 배열. 이어붙이면 word와 글자가 정확히 같아야 함.\n' +
          '형식: {"words":[{"word":"creature","meaning":"생명체","chunks":["crea","ture"]}]}\n' +
          'JSON만 출력.' },
      ],
    }],
  });
  const parsed = extractJson(text);
  return sanitizeWords(parsed?.words);
}

async function extractPhonics(words) {
  const text = await callClaude({
    system: "You are a phonics teacher for Korean elementary students. Return JSON only.",
    messages: [{
      role: "user",
      content:
        "단어: " + words.map((w) => w.word).join(", ") + "\n\n" +
        "이 목록에서 초등 4학년이 배우면 좋을 공통 파닉스 규칙을 정확히 5개 뽑아줘. 목록에 2개 이상 해당되는 규칙을 우선.\n" +
        "pattern: 규칙 (예: -ture, -tion, igh, 묵음 c)\n" +
        "sound: 한글로 쓴 소리 (예: 처)\n" +
        "tip: 초등학생에게 하는 한 문장 설명\n" +
        "words: 목록 중 해당되는 단어들\n" +
        '형식: {"phonics":[{"pattern":"-ture","sound":"처","tip":"...","words":["creature"]}]}\n' +
        "JSON만 출력.",
    }],
  });
  const parsed = extractJson(text);
  return Array.isArray(parsed?.phonics) ? parsed.phonics.slice(0, 5) : [];
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("사진을 읽지 못했어요"));
    r.readAsDataURL(file);
  });
}

/* ────────────────────────────────────────────────────────────
   공용 조각
   ──────────────────────────────────────────────────────────── */

function ChunkWord({ chunks, highlight, size = "lg", onChunk }) {
  const lower = (highlight || "").toLowerCase().replace(/[^a-z]/g, "");
  return (
    <span className={"wl-chunkrow wl-chunkrow-" + size}>
      {chunks.map((c, i) => {
        const hit = lower && c.toLowerCase().includes(lower);
        return (
          <span
            key={i}
            className={"wl-chunk " + (i % 2 ? "wl-chunk-b" : "wl-chunk-a") + (hit ? " wl-chunk-hit" : "")}
            onClick={() => onChunk && onChunk(c)}
            role={onChunk ? "button" : undefined}
            tabIndex={onChunk ? 0 : undefined}
            onKeyDown={(e) => { if (onChunk && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onChunk(c); } }}
          >{c}</span>
        );
      })}
    </span>
  );
}

function SpeakBtn({ text, label = "듣기", rate = 0.8, big }) {
  return (
    <button className={"wl-speak" + (big ? " wl-speak-big" : "")} onClick={() => speak(text, rate)}>
      <span className="wl-speak-ico">♪</span>{label}
    </button>
  );
}

function Steps({ current }) {
  const items = ["사진", "파닉스", "덩어리", "시험", "오답", "최종"];
  const idx = { upload: 0, phonics: 1, chunks: 2, quiz: 3, review: 4, final: 5, done: 5 }[current] ?? 0;
  return (
    <ol className="wl-steps">
      {items.map((label, i) => (
        <li key={label} className={"wl-step " + (i < idx ? "done" : i === idx ? "now" : "todo")}>
          <span className="wl-step-n">{i < idx ? "✓" : i + 1}</span>
          <span className="wl-step-l">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ────────────────────────────────────────────────────────────
   1. 사진 올리기
   ──────────────────────────────────────────────────────────── */

function Upload({ onWords, saved, onResume }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  async function run() {
    setBusy(true); setErr(""); 
    try {
      const all = [];
      for (let i = 0; i < files.length; i++) {
        setNote(files.length + "장 중 " + (i + 1) + "번째 사진을 읽는 중");
        const b64 = await fileToBase64(files[i]);
        const got = await extractFromImage(b64, files[i].type || "image/jpeg");
        all.push(...got);
      }
      const merged = sanitizeWords(all);
      if (merged.length === 0) throw new Error("단어를 찾지 못했어요. 글자가 잘 보이게 다시 찍어주세요.");
      setNote("파닉스 규칙을 고르는 중");
      let phonics = [];
      try { phonics = await extractPhonics(merged); } catch { phonics = []; }
      onWords(merged, phonics);
    } catch (e) {
      setErr(e.message || "잘 되지 않았어요. 한 번 더 눌러주세요.");
    } finally {
      setBusy(false); setNote("");
    }
  }

  return (
    <div className="wl-pane">
      <h1 className="wl-h1">단어장 사진을 올리면<br />오늘 공부가 만들어져요</h1>
      <p className="wl-sub">사진에서 단어와 뜻을 읽어내고, 공통 파닉스 규칙 다섯 개를 뽑아 시험까지 이어집니다.</p>

      <div className="wl-drop" onClick={() => !busy && inputRef.current?.click()}>
        <div className="wl-drop-ico">📷</div>
        <div className="wl-drop-t">{files.length ? files.length + "장 선택함" : "사진 고르기"}</div>
        <div className="wl-drop-s">한 번에 여러 장 가능. 한 장에 15개 이하면 잘 읽어요.</div>
        <input
          ref={inputRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { setFiles([...e.target.files]); setErr(""); }}
        />
      </div>

      {files.length > 0 && (
        <ul className="wl-filelist">
          {files.map((f, i) => <li key={i}>{f.name}</li>)}
        </ul>
      )}

      {err && <div className="wl-err">{err}</div>}

      <button className="wl-cta" disabled={!files.length || busy} onClick={run}>
        {busy ? note || "읽는 중" : "단어 뽑기"}
      </button>

      {busy && <div className="wl-bar"><span /></div>}

      {saved?.words?.length > 0 && !busy && (
        <button className="wl-ghost" onClick={onResume}>
          지난번 단어장 이어서 하기 ({saved.words.length}개)
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   2. 파닉스
   ──────────────────────────────────────────────────────────── */

function Phonics({ phonics, words, onNext }) {
  const byWord = Object.fromEntries(words.map((w) => [w.word, w]));
  return (
    <div className="wl-pane">
      <h2 className="wl-h2">오늘 단어에 숨은 규칙 {phonics.length}개</h2>
      <p className="wl-sub">규칙 하나를 알면 단어 여러 개가 한꺼번에 풀려요. 단어를 눌러 소리를 들어보세요.</p>

      {phonics.length === 0 && <div className="wl-err">규칙을 만들지 못했어요. 다음 단계로 넘어가도 괜찮아요.</div>}

      {phonics.map((p, i) => (
        <div className="wl-rule" key={i}>
          <div className="wl-rule-head">
            <span className="wl-pattern">{p.pattern}</span>
            <span className="wl-sound">{p.sound}</span>
          </div>
          <p className="wl-tip">{p.tip}</p>
          <div className="wl-rule-words">
            {(p.words || []).map((w) => {
              const item = byWord[w] || { word: w, chunks: [w] };
              return (
                <button key={w} className="wl-wordpill" onClick={() => speak(item.word)}>
                  <ChunkWord chunks={item.chunks} highlight={p.pattern} size="sm" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button className="wl-cta" onClick={onNext}>덩어리로 읽어보기</button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   3. 덩어리 읽기
   ──────────────────────────────────────────────────────────── */

function Chunks({ words, onNext }) {
  const [i, setI] = useState(0);
  const w = words[i];
  const last = i === words.length - 1;

  useEffect(() => { speak(w.word); }, [i]); // eslint-disable-line

  return (
    <div className="wl-pane">
      <div className="wl-count">{i + 1} / {words.length}</div>

      <div className="wl-stage">
        <ChunkWord chunks={w.chunks} onChunk={(c) => speak(c, 0.6)} />
        <div className="wl-meaning">{w.meaning}</div>
        <div className="wl-row">
          <SpeakBtn text={w.word} label="듣기" big />
          <SpeakBtn text={w.word} label="천천히" rate={0.5} big />
        </div>
        <p className="wl-note">덩어리를 하나씩 누르면 그 부분만 들려요. 입으로 따라 말하면서 손으로 써보세요.</p>
      </div>

      <div className="wl-row">
        <button className="wl-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>이전</button>
        {last
          ? <button className="wl-cta wl-inline" onClick={onNext}>시험 보러 가기</button>
          : <button className="wl-cta wl-inline" onClick={() => setI(i + 1)}>다음</button>}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   4·5·6. 시험 / 오답 / 최종
   ──────────────────────────────────────────────────────────── */

const TYPE_LABEL = { spell: "뜻 보고 쓰기", listen: "듣고 쓰기", meaning: "뜻 고르기" };

function Quiz({ words, seed, title, subtitle, onDone }) {
  const [quiz] = useState(() => buildQuiz(words, { seed }));
  const [i, setI] = useState(0);
  const [value, setValue] = useState("");
  const [judged, setJudged] = useState(null);
  const [results, setResults] = useState([]);
  const [hintOn, setHintOn] = useState(false);
  const inputRef = useRef(null);

  const q = quiz[i];

  useEffect(() => {
    setValue(""); setJudged(null); setHintOn(false);
    if (q?.type === "listen") speak(q.word);
    if (q?.type !== "meaning") setTimeout(() => inputRef.current?.focus(), 60);
  }, [i]); // eslint-disable-line

  const check = useCallback((raw) => {
    if (judged) return;
    const g = gradeAnswer(q, raw);
    setJudged(g);
    if (g.correct) speak(q.word);
    setResults((r) => [...r, { word: q.word, correct: g.correct }]);
  }, [judged, q]);

  function next() {
    if (i === quiz.length - 1) onDone(results);
    else setI(i + 1);
  }

  if (!q) return null;

  return (
    <div className="wl-pane">
      <div className="wl-quizhead">
        <span className="wl-badge">{TYPE_LABEL[q.type]}</span>
        <span className="wl-count">{i + 1} / {quiz.length}</span>
      </div>
      <div className="wl-progress"><span style={{ width: ((i) / quiz.length) * 100 + "%" }} /></div>
      <h2 className="wl-h2 wl-h2-tight">{title}</h2>
      {subtitle && <p className="wl-sub">{subtitle}</p>}

      <div className="wl-stage">
        {q.type === "spell" && <div className="wl-prompt">{q.meaning}</div>}
        {q.type === "meaning" && <div className="wl-prompt wl-prompt-en">{q.word}</div>}
        {q.type === "listen" && (
          <div className="wl-row wl-center">
            <SpeakBtn text={q.word} label="다시 듣기" big />
            <SpeakBtn text={q.word} label="천천히" rate={0.5} big />
          </div>
        )}

        {q.type === "meaning" ? (
          <div className="wl-options">
            {q.options.map((opt) => (
              <button
                key={opt}
                className={"wl-opt" + (judged && opt === q.meaning ? " ok" : "") +
                  (judged && !judged.correct && opt !== q.meaning ? " dim" : "")}
                disabled={!!judged}
                onClick={() => check(opt)}
              >{opt}</button>
            ))}
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              className={"wl-input" + (judged ? (judged.correct ? " ok" : " no") : "")}
              value={value}
              placeholder="영어로 쓰기"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              disabled={!!judged}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") check(value); }}
            />
            {!judged && (
              <div className="wl-row wl-center">
                {q.type === "listen" && <button className="wl-ghost wl-sm" onClick={() => setHintOn(true)}>뜻 보기</button>}
                <button className="wl-ghost wl-sm" onClick={() => setHintOn(true)}>힌트</button>
                <button className="wl-ghost wl-sm" onClick={() => check("")}>모르겠어요</button>
              </div>
            )}
            {hintOn && !judged && (
              <div className="wl-hint">
                <span className="wl-hint-mask">{q.hint}</span>
                <span className="wl-hint-meaning">{q.meaning}</span>
              </div>
            )}
            {!judged && <button className="wl-cta" onClick={() => check(value)}>확인</button>}
          </>
        )}

        {judged && (
          <div className={"wl-verdict " + (judged.correct ? "ok" : "no")}>
            <div className="wl-verdict-t">{judged.correct ? "맞았어요" : "정답을 볼까요"}</div>
            <ChunkWord chunks={q.chunks} onChunk={(c) => speak(c, 0.6)} />
            <div className="wl-meaning">{q.meaning}</div>
            {!judged.correct && judged.matched > 0 && (
              <p className="wl-note">앞의 {judged.matched}글자는 맞았어요. 뒷부분만 다시 보면 돼요.</p>
            )}
            <button className="wl-cta" onClick={next}>
              {i === quiz.length - 1 ? "결과 보기" : "다음"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Result({ summary, words, mode, onNext, onRetry }) {
  const good = summary.percent >= 80;
  return (
    <div className="wl-pane">
      <div className="wl-score">
        <span className="wl-score-n">{summary.correct}</span>
        <span className="wl-score-d">/ {summary.total}</span>
      </div>
      <h2 className="wl-h2 wl-center-t">
        {good ? "잘했어요" : summary.correct > 0 ? "여기까지 왔어요" : "이제 시작이에요"}
      </h2>

      {summary.wrong.length > 0 ? (
        <>
          <p className="wl-sub">다시 볼 단어 {summary.wrong.length}개예요. 맞힌 건 넘어가고 이것만 돌릴게요.</p>
          <div className="wl-wronglist">
            {words.filter((w) => summary.wrong.includes(w.word)).map((w) => (
              <button key={w.word} className="wl-wordpill" onClick={() => speak(w.word)}>
                <ChunkWord chunks={w.chunks} size="sm" />
                <span className="wl-pill-meaning">{w.meaning}</span>
              </button>
            ))}
          </div>
          <button className="wl-cta" onClick={onNext}>
            {mode === "final" ? "틀린 것만 한 번 더" : "틀린 것만 다시 풀기"}
          </button>
        </>
      ) : (
        <p className="wl-sub">전부 맞혔어요. 오답 단계는 건너뛸게요.</p>
      )}

      {summary.wrong.length === 0 && (
        <button className="wl-cta" onClick={onNext}>
          {mode === "final" ? "처음으로" : "최종 시험 보기"}
        </button>
      )}
      {mode !== "final" && <button className="wl-ghost" onClick={onRetry}>이 단계 다시 풀기</button>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   앱
   ──────────────────────────────────────────────────────────── */

export default function WordLab() {
  const [step, setStep] = useState("upload");
  const [words, setWords] = useState([]);
  const [phonics, setPhonics] = useState([]);
  const [wrongWords, setWrongWords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [stage, setStage] = useState("quiz");
  const [saved, setSaved] = useState(null);
  const [seedBump, setSeedBump] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await window.storage.get("wordlab:current");
        if (alive && r?.value) setSaved(JSON.parse(r.value));
      } catch { /* 저장된 게 없으면 그냥 새로 시작 */ }
    })();
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
    return () => { alive = false; };
  }, []);

  async function persist(w, p) {
    try {
      await window.storage.set("wordlab:current", JSON.stringify({ words: w, phonics: p, at: Date.now() }));
    } catch { /* 저장 실패해도 학습은 계속 */ }
  }

  function start(w, p) {
    setWords(w); setPhonics(p); persist(w, p); setStep("phonics");
  }

  function finishStage(results, mode) {
    const s = summarize(results);
    setSummary(s);
    setWrongWords(collectWrong(mode === "review" ? wrongWords : words, results));
    setStage(mode);
    setStep("result");
  }

  function afterResult() {
    if (stage === "quiz") {
      if (wrongWords.length > 0) { setStep("review"); }
      else { setStep("final"); }
    } else if (stage === "review") {
      setStep("final");
    } else {
      if (wrongWords.length > 0) { setStage("quiz"); setStep("review"); }
      else { reset(); }
    }
  }

  function reset() {
    setStep("upload"); setWords([]); setPhonics([]); setWrongWords([]); setSummary(null);
  }

  const shellStep = step === "result" ? (stage === "final" ? "final" : stage) : step;

  return (
    <div className="wl">
      <style>{CSS}</style>
      <div className="wl-shell">
        <header className="wl-top">
          <span className="wl-logo">단어 연습</span>
          {words.length > 0 && <button className="wl-reset" onClick={reset}>새 단어장</button>}
        </header>

        {step !== "upload" && <Steps current={shellStep} />}

        {step === "upload" && (
          <Upload
            onWords={start}
            saved={saved}
            onResume={() => { if (saved) { setWords(saved.words); setPhonics(saved.phonics || []); setStep("phonics"); } }}
          />
        )}

        {step === "phonics" && <Phonics phonics={phonics} words={words} onNext={() => setStep("chunks")} />}

        {step === "chunks" && <Chunks words={words} onNext={() => setStep("quiz")} />}

        {step === "quiz" && (
          <Quiz key={"q" + seedBump} words={words} seed={11 + seedBump}
            title="1차 시험" subtitle="틀려도 괜찮아요. 틀린 것만 따로 모아둘게요."
            onDone={(r) => finishStage(r, "quiz")} />
        )}

        {step === "review" && (
          <Quiz key={"r" + seedBump} words={wrongWords} seed={29 + seedBump}
            title="오답 복습" subtitle="아까 놓친 것만 모았어요."
            onDone={(r) => finishStage(r, "review")} />
        )}

        {step === "final" && (
          <Quiz key={"f" + seedBump} words={words} seed={97 + seedBump}
            title="최종 시험" subtitle="전체 단어를 순서 바꿔서 한 번에."
            onDone={(r) => finishStage(r, "final")} />
        )}

        {step === "result" && summary && (
          <Result
            summary={summary}
            words={words}
            mode={stage}
            onNext={afterResult}
            onRetry={() => { setSeedBump((n) => n + 1); setStep(stage); }}
          />
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   스타일
   ──────────────────────────────────────────────────────────── */

const CSS = `
.wl{--bg:#EDF3F8;--ink:#16324F;--ink2:#5D7891;--card:#fff;--line:#D6E3EE;--hl:#FFE24A;--acc:#3D8BD3;--ok:#2E9E6B;--no:#E8776A;
  background:var(--bg);color:var(--ink);min-height:100%;padding:16px 12px 48px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Noto Sans KR",sans-serif;
  -webkit-text-size-adjust:100%;}
.wl *{box-sizing:border-box}
.wl-shell{max-width:520px;margin:0 auto}
.wl-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.wl-logo{font-weight:800;font-size:15px;letter-spacing:-.01em}
.wl-reset{background:none;border:none;color:var(--ink2);font-size:13px;padding:6px;cursor:pointer;font-family:inherit}

.wl-steps{display:flex;gap:4px;list-style:none;padding:0;margin:0 0 18px}
.wl-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.wl-step-n{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;
  background:#fff;border:1.5px solid var(--line);color:var(--ink2)}
.wl-step-l{font-size:10px;color:var(--ink2)}
.wl-step.now .wl-step-n{background:var(--acc);border-color:var(--acc);color:#fff}
.wl-step.now .wl-step-l{color:var(--acc);font-weight:700}
.wl-step.done .wl-step-n{background:var(--ok);border-color:var(--ok);color:#fff}

.wl-pane{display:flex;flex-direction:column;gap:14px}
.wl-h1{font-size:26px;line-height:1.35;font-weight:800;margin:6px 0 0;letter-spacing:-.02em}
.wl-h2{font-size:19px;font-weight:800;margin:0;letter-spacing:-.01em}
.wl-h2-tight{margin-top:2px}
.wl-center-t{text-align:center}
.wl-sub{font-size:14px;line-height:1.65;color:var(--ink2);margin:0}
.wl-note{font-size:13px;line-height:1.6;color:var(--ink2);margin:2px 0 0}

.wl-drop{background:var(--card);border:2px dashed var(--line);border-radius:18px;padding:32px 20px;text-align:center;cursor:pointer}
.wl-drop:hover{border-color:var(--acc)}
.wl-drop-ico{font-size:34px;margin-bottom:8px}
.wl-drop-t{font-weight:800;font-size:16px}
.wl-drop-s{font-size:12.5px;color:var(--ink2);margin-top:6px}
.wl-filelist{margin:0;padding:0 0 0 18px;font-size:12.5px;color:var(--ink2);line-height:1.8}

.wl-cta{background:var(--acc);color:#fff;border:none;border-radius:14px;padding:15px 20px;font-size:16px;font-weight:800;
  cursor:pointer;font-family:inherit;width:100%}
.wl-cta:disabled{background:#B9CEDE;cursor:default}
.wl-cta.wl-inline{width:auto;flex:1}
.wl-ghost{background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:14px;padding:13px 18px;
  font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;width:100%}
.wl-ghost:disabled{color:#B9CEDE;cursor:default}
.wl-ghost.wl-sm{width:auto;padding:9px 14px;font-size:13px;border-radius:11px}
.wl-row{display:flex;gap:8px;align-items:center}
.wl-center{justify-content:center;flex-wrap:wrap}
.wl-err{background:#FDECEA;color:#A33B2E;border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.6}
.wl-bar{height:4px;background:var(--line);border-radius:4px;overflow:hidden}
.wl-bar span{display:block;height:100%;width:36%;background:var(--acc);border-radius:4px;
  animation:wlslide 1.1s ease-in-out infinite}
@keyframes wlslide{0%{margin-left:-36%}100%{margin-left:100%}}

.wl-rule{background:var(--card);border-radius:16px;padding:16px}
.wl-rule-head{display:flex;align-items:baseline;gap:10px}
.wl-pattern{font-size:22px;font-weight:800;letter-spacing:.01em}
.wl-sound{background:var(--hl);border-radius:6px;padding:2px 8px;font-size:14px;font-weight:700}
.wl-tip{font-size:13.5px;line-height:1.6;color:var(--ink2);margin:8px 0 12px}
.wl-rule-words{display:flex;flex-wrap:wrap;gap:6px}
.wl-wordpill{background:#F3F8FC;border:1px solid var(--line);border-radius:11px;padding:8px 10px;cursor:pointer;
  font-family:inherit;display:flex;flex-direction:column;gap:3px;align-items:flex-start}
.wl-pill-meaning{font-size:11.5px;color:var(--ink2)}

.wl-chunkrow{display:inline-flex;flex-wrap:wrap;gap:2px;justify-content:center}
.wl-chunk{padding:4px 5px;border-radius:6px;font-weight:800;letter-spacing:-.01em;line-height:1.2}
.wl-chunkrow-lg .wl-chunk{font-size:34px;padding:6px 7px}
.wl-chunkrow-sm .wl-chunk{font-size:15px;padding:2px 4px}
.wl-chunk-a{background:#E3EDF6}
.wl-chunk-b{background:#F7DDE4}
.wl-chunk-hit{background:var(--hl)}
.wl-chunkrow-lg .wl-chunk{cursor:pointer}

.wl-stage{background:var(--card);border-radius:18px;padding:22px 18px;display:flex;flex-direction:column;
  gap:14px;align-items:center;text-align:center}
.wl-meaning{font-size:16px;font-weight:700;color:var(--ink2)}
.wl-count{font-size:12.5px;color:var(--ink2);font-weight:700}
.wl-prompt{font-size:26px;font-weight:800;line-height:1.4;letter-spacing:-.01em}
.wl-prompt-en{font-size:34px}

.wl-speak{background:var(--acc);color:#fff;border:none;border-radius:12px;padding:10px 16px;font-size:14px;
  font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.wl-speak-big{padding:14px 22px;font-size:16px;border-radius:14px}
.wl-speak-ico{font-size:15px}

.wl-quizhead{display:flex;align-items:center;justify-content:space-between}
.wl-badge{background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700}
.wl-progress{height:5px;background:#DCE7F0;border-radius:5px;overflow:hidden}
.wl-progress span{display:block;height:100%;background:var(--acc);border-radius:5px;transition:width .25s ease}

.wl-input{width:100%;border:2px solid var(--line);border-radius:14px;padding:16px;font-size:24px;font-weight:700;
  text-align:center;font-family:inherit;color:var(--ink);background:#FBFDFF}
.wl-input:focus{outline:none;border-color:var(--acc)}
.wl-input.ok{border-color:var(--ok);background:#EDF8F2}
.wl-input.no{border-color:var(--no);background:#FDF0EE}

.wl-options{display:flex;flex-direction:column;gap:8px;width:100%}
.wl-opt{background:#F3F8FC;border:1.5px solid var(--line);border-radius:13px;padding:15px;font-size:16px;
  font-weight:700;cursor:pointer;font-family:inherit;color:var(--ink)}
.wl-opt.ok{background:#E4F5EC;border-color:var(--ok);color:#1F7A50}
.wl-opt.dim{opacity:.45}

.wl-hint{display:flex;flex-direction:column;gap:6px;align-items:center}
.wl-hint-mask{font-size:22px;font-weight:800;letter-spacing:.12em;background:var(--hl);border-radius:8px;padding:6px 12px}
.wl-hint-meaning{font-size:14px;color:var(--ink2);font-weight:700}

.wl-verdict{display:flex;flex-direction:column;gap:12px;align-items:center;width:100%;border-top:1.5px solid var(--line);padding-top:16px}
.wl-verdict-t{font-size:15px;font-weight:800}
.wl-verdict.ok .wl-verdict-t{color:var(--ok)}
.wl-verdict.no .wl-verdict-t{color:var(--no)}

.wl-score{text-align:center;padding:10px 0 0}
.wl-score-n{font-size:64px;font-weight:800;letter-spacing:-.03em}
.wl-score-d{font-size:22px;font-weight:700;color:var(--ink2);margin-left:6px}
.wl-wronglist{display:flex;flex-wrap:wrap;gap:6px}

@media (prefers-reduced-motion:reduce){.wl *{animation:none!important;transition:none!important}}
.wl button:focus-visible,.wl input:focus-visible{outline:3px solid #9CC6E8;outline-offset:2px}
`;
