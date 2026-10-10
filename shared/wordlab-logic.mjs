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
 * type: 'spell'(뜻→철자) | 'listen'(듣고 철자) | 'meaning'(단어→뜻 4지선다) | 'define'(단어→영어 풀이 쓰기)
 *
 * lang 'en' 은 영어 풀이 단어장(영영)이다.
 *   - spell 의 문제 글(prompt)은 풀이에서 표제어를 ___ 로 가린 것. 풀이에 단어가 그대로 들어 있어서다
 *   - define 은 핵심 낱말(keys)로 채점한다
 */
export function buildQuiz(words, opts = {}) {
  const { types = ['spell', 'listen', 'meaning'], seed = 1, lang = 'ko' } = opts;
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
    if (w.ko) q.ko = w.ko;
    if (w.example) q.example = w.example;
    if (lang === 'en') {
      const keys = Array.isArray(w.keys) && w.keys.length ? w.keys : autoKeys(w.meaning, w.word);
      q.keys = keys;
      q.prompt = type === 'define' ? w.word : blankWord(w.meaning, w.word);
      q.defHint = maskDefinition(w.meaning, keys);
      if (w.example) q.exampleBlank = blankWord(w.example, w.word);
    }
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
  if (question.type === 'define') {
    const g = gradeDefinition(raw, question.keys, question.meaning, question.word);
    return { correct: g.correct, matched: 0, found: g.found, missing: g.missing, total: g.total };
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
    // 영어 풀이 단어장에만 있는 칸. 있을 때만 붙여서 한글 뜻 단어장의 모양은 그대로 둔다
    const extra = {};
    const example = String(item?.example ?? '').replace(/\s+/g, ' ').trim();
    if (example) extra.example = example;
    if (Array.isArray(item?.keys)) {
      const keys = item.keys.map((k) => String(k ?? '').trim()).filter(Boolean);
      if (keys.length) extra.keys = keys;
    }
    const ko = String(item?.ko ?? '').trim();
    if (ko) extra.ko = ko;
    out.push({ word, meaning, chunks, ...extra });
  }
  return out;
}

/* ── 영어 풀이(영영) 채점 ─────────────────────────────────────────── */

/**
 * 표제어의 흔한 변화형. creatures, reefs, recognized 처럼 쓰인 것도 같은 단어로 본다.
 * (지문의 아는 단어 표시와 풀이 속 표제어 가리기가 함께 쓴다)
 */
export function wordForms(word) {
  const k = String(word ?? '').toLowerCase().trim();
  if (!/[a-z]$/.test(k)) return k ? [k] : [];
  const out = [k, k + 's', k + 'es', k + 'ed', k + 'ing', k + 'ly'];
  if (k.endsWith('e')) {
    const stem = k.slice(0, -1);
    out.push(k + 'd', stem + 'ing');
  }
  if (k.endsWith('y')) out.push(k.slice(0, -1) + 'ies', k.slice(0, -1) + 'ied');
  return [...new Set(out)];
}

/** 영어 글 → 소문자 낱말 목록. 1,000,000 같은 숫자는 쉼표를 떼어 한 낱말로 */
export function tokenizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** 아주 단순한 어간. plants/plant, rises/rise/rising, colored/color 를 같게 본다 */
export function stemWord(token) {
  let s = String(token ?? '').toLowerCase();
  if (s.length > 4 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.length > 4 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 3 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 3 && /(ss|x|ch|sh|s|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/** 풀이에서 빠져도 뜻이 통하는 낱말. 핵심 낱말을 자동으로 고를 때 뺀다 */
export const STOPWORDS = new Set(
  (
    'a an the is are was were be been being am of to for in on at by with from into onto about as and or but so ' +
    'if than then that this these those there here it its they them their he she his her you your we our i me my ' +
    'what which who whom whose where when how why can could will would should may might must do does did has have ' +
    'had not no very also too just only some any something someone somebody anything thing things way another other ' +
    'one kind type used use means mean called word describes describe shows show'
  ).split(' ')
);

/** 풀이의 내용 낱말 (불용어·표제어 제외, 중복 없이, 나온 순서대로) */
export function contentWords(definition, headword) {
  const head = new Set(wordForms(headword).flatMap((f) => tokenizeText(f)).map(stemWord));
  const seen = new Set();
  const out = [];
  for (const t of tokenizeText(definition)) {
    if (STOPWORDS.has(t)) continue;
    const st = stemWord(t);
    if (head.has(st) || seen.has(st)) continue;
    if (t.length < 2 && !/\d/.test(t)) continue;
    seen.add(st);
    out.push(t);
  }
  return out;
}

/** 모델이 핵심 낱말을 못 줬을 때 쓰는 대체: 내용 낱말 앞에서부터 max 개 */
export function autoKeys(definition, headword, max = 4) {
  return contentWords(definition, headword).slice(0, max);
}

/**
 * 풀이 쓰기 채점. 영어 문장을 글자 그대로 맞추는 건 무리라 핵심 낱말이 다 들어 있으면 맞은 것으로 본다.
 * 변화형(plant/plants, rise/rises)은 같게 본다.
 * @returns {{correct, found: string[], missing: string[], total}}
 */
export function gradeDefinition(answer, keys, definition = '', headword = '') {
  let list = (Array.isArray(keys) ? keys : []).map((k) => String(k ?? '').trim()).filter(Boolean);
  if (list.length === 0) list = autoKeys(definition, headword);
  if (list.length === 0) {
    // 풀이에 내용 낱말이 하나도 없다. 통째로 비교한다
    const ok = normalize(answer) !== '' && normalize(answer) === normalize(definition);
    return { correct: ok, found: [], missing: [], total: 0 };
  }
  const got = new Set(tokenizeText(answer).map(stemWord));
  const found = [];
  const missing = [];
  for (const k of list) {
    const parts = tokenizeText(k).map(stemWord);
    (parts.length > 0 && parts.every((p) => got.has(p)) ? found : missing).push(k);
  }
  return { correct: missing.length === 0, found, missing, total: list.length };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 글에서 표제어(와 변화형)를 ___ 로 가린다.
 * 영영 풀이는 "Because introduces a reason..." 처럼 단어가 그대로 들어 있어서,
 * 풀이를 보고 단어를 쓰는 문제에서는 가려야 답이 보이지 않는다.
 */
export function blankWord(text, word, blank = '___') {
  const src = String(text ?? '');
  const forms = wordForms(word).sort((a, b) => b.length - a.length);
  if (!src || forms.length === 0) return src;
  const re = new RegExp('(?<![A-Za-z])(' + forms.map(escapeRe).join('|') + ')(?![A-Za-z])', 'gi');
  return src.replace(re, blank);
}

/**
 * 풀이를 조각으로 나눠 핵심 낱말에 표시를 단다. 채점 뒤 "쓴 낱말 / 빠진 낱말" 을 보여줄 때 쓴다.
 * [{ text }] 또는 [{ text, mark: 'found' | 'missing' }]. 조각을 이으면 원래 풀이와 같다.
 */
export function markKeys(definition, found = [], missing = []) {
  const toStems = (list) => new Set((Array.isArray(list) ? list : []).flatMap((k) => tokenizeText(k)).map(stemWord));
  const f = toStems(found);
  const m = toStems(missing);
  const src = String(definition ?? '');
  const out = [];
  let last = 0;
  for (const mt of src.matchAll(/\d{1,3}(?:,\d{3})+|[A-Za-z0-9']+/g)) {
    const t = tokenizeText(mt[0])[0];
    const st = t ? stemWord(t) : '';
    const mark = m.has(st) ? 'missing' : f.has(st) ? 'found' : null;
    if (!mark) continue;
    if (mt.index > last) out.push({ text: src.slice(last, mt.index) });
    out.push({ text: mt[0], mark });
    last = mt.index + mt[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

/** 풀이에서 핵심 낱말만 마스크 힌트로 바꾼다. "a reason" → "a r _ _ s _ n" */
export function maskDefinition(definition, keys) {
  const stems = new Set((Array.isArray(keys) ? keys : []).flatMap((k) => tokenizeText(k)).map(stemWord));
  const src = String(definition ?? '');
  if (stems.size === 0) return src;
  return src.replace(/\d{1,3}(?:,\d{3})+|[A-Za-z0-9']+/g, (tok) => {
    const t = tokenizeText(tok)[0];
    return t && stems.has(stemWord(t)) ? hintMask(tok) : tok;
  });
}
