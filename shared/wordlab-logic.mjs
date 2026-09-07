// wordlab-logic.mjs
// 단어 학습 앱의 순수 로직. DOM 도 Nest 도 모른다.
// 프론트(src/)와 서버 함수(api/)가 이 파일을 함께 import 한다.

/** 채점용 정규화: 소문자, 영문/공백만, 공백 축약 */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 철자 정답 여부 */
export function isCorrect(input, answer) {
  const a = normalize(answer);
  if (!a) return false;
  return normalize(input) === a;
}

/** 앞에서부터 몇 글자가 맞았는지 (부분 정답 피드백용) */
export function commonPrefixLen(input, answer) {
  const x = normalize(input);
  const y = normalize(answer);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/**
 * 힌트 마스크. 첫 글자·마지막 글자·3의 배수 위치만 보여주고 나머지는 _
 * coral -> "c _ _ a l"
 */
export function hintMask(word) {
  const chars = [...String(word ?? '')];
  if (chars.length === 0) return '';
  return chars
    .map((c, i) => {
      if (c === ' ' || c === '-') return c;
      if (i === 0 || i === chars.length - 1) return c;
      if (i % 3 === 0) return c;
      return '_';
    })
    .join(' ');
}

/** 결정적 난수 (mulberry32) */
export function makeRng(seed) {
  let t = (Number(seed) || 1) >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** 원본을 건드리지 않는 셔플 */
export function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 객관식 오답 보기 뽑기 */
export function pickDistractors(words, correctWord, count, rng) {
  const pool = words.filter((w) => w.word !== correctWord.word);
  return shuffle(pool, rng).slice(0, count);
}

/**
 * 퀴즈 생성.
 * types 를 순환 배정해서 유형이 한쪽으로 쏠리지 않게 한다.
 * type: 'spell'(뜻→철자) | 'listen'(듣고 철자) | 'meaning'(단어→뜻 4지선다)
 */
export function buildQuiz(words, opts = {}) {
  const { types = ['spell', 'listen', 'meaning'], seed = 1 } = opts;
  if (!Array.isArray(words) || words.length === 0) return [];
  const rng = makeRng(seed);
  const ordered = shuffle(words, rng);

  return ordered.map((w, i) => {
    const type = types[i % types.length];
    const q = {
      id: w.word,
      type,
      word: w.word,
      meaning: w.meaning,
      chunks: Array.isArray(w.chunks) && w.chunks.length ? w.chunks : [w.word],
      hint: hintMask(w.word),
    };
    if (type === 'meaning') {
      const distractors = pickDistractors(words, w, 3, rng);
      q.options = shuffle(
        [w, ...distractors].map((d) => d.meaning),
        rng
      );
    }
    return q;
  });
}

/** 답안 채점 */
export function gradeAnswer(question, raw) {
  if (question.type === 'meaning') {
    const ok = String(raw ?? '').trim() === String(question.meaning).trim();
    return { correct: ok, matched: 0 };
  }
  const ok = isCorrect(raw, question.word);
  return { correct: ok, matched: ok ? 0 : commonPrefixLen(raw, question.word) };
}

/** 세션 집계 */
export function summarize(results) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const wrong = results.filter((r) => !r.correct).map((r) => r.word);
  return {
    total,
    correct,
    wrong,
    percent: total === 0 ? 0 : Math.round((correct / total) * 100),
  };
}

/** 오답만 남기기 (중복 제거, 원래 단어 객체로 복원) */
export function collectWrong(words, results) {
  const wrongSet = new Set(results.filter((r) => !r.correct).map((r) => r.word));
  return words.filter((w) => wrongSet.has(w.word));
}

/** API 응답에서 JSON 뽑아내기 (```json 펜스, 앞뒤 잡소리 대응) */
export function extractJson(text) {
  const cleaned = String(text ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** chunks 를 이어붙이면 word 철자와 같은가 (대소문자·공백 무시) */
export function chunksMatch(word, chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return false;
  const squash = (s) => String(s ?? '').toLowerCase().replace(/\s/g, '');
  return squash(chunks.join('')) === squash(word);
}

/**
 * 추출 결과 정리: 빈 값 제거, 중복 단어 제거, chunks 보정
 * keepEmptyMeaning: 뜻이 빈 항목을 남긴다. 검수 화면에 "뜻이 비었어요"로 띄워 부모가 채우게 할 때 쓴다.
 * 저장 직전(검수 확정)에는 기본값(false)으로 다시 걸러야 한다.
 */
export function sanitizeWords(raw, { keepEmptyMeaning = false } = {}) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const word = String(item?.word ?? '').trim();
    const meaning = String(item?.meaning ?? '').trim();
    if (!word) continue;
    if (!meaning && !keepEmptyMeaning) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let chunks = Array.isArray(item?.chunks)
      ? item.chunks.map((c) => String(c).trim()).filter(Boolean)
      : [];
    if (!chunksMatch(word, chunks)) {
      chunks = [word];
    }
    out.push({ word, meaning, chunks });
  }
  return out;
}
