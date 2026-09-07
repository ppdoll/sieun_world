// shared/extract-logic.mjs
// 사진 → 단어 추출 과정의 순수 로직. 모델을 직접 호출하지 않는다.
// 프롬프트 생성, 응답 해석(잘림·거절·JSON 복구·스키마 검증), 검수용 신뢰도 표시.

import { chunksMatch, extractJson, sanitizeWords } from './wordlab-logic.mjs';

/* ── 응답 스키마 (output_config.format 에 그대로 넘긴다) ───────────── */

export const WORDS_SCHEMA = {
  type: 'object',
  properties: {
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          meaning: { type: 'string' },
          chunks: { type: 'array', items: { type: 'string' } },
        },
        required: ['word', 'meaning', 'chunks'],
        additionalProperties: false,
      },
    },
  },
  required: ['words'],
  additionalProperties: false,
};

export const PHONICS_SCHEMA = {
  type: 'object',
  properties: {
    phonics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          letters: { type: 'array', items: { type: 'string' } },
          sound: { type: 'string' },
          tip: { type: 'string' },
          words: { type: 'array', items: { type: 'string' } },
        },
        required: ['pattern', 'letters', 'sound', 'tip', 'words'],
        additionalProperties: false,
      },
    },
  },
  required: ['phonics'],
  additionalProperties: false,
};

/* ── 프롬프트 ───────────────────────────────────────────────────── */

export const WORDS_SYSTEM =
  'You read photos of Korean-English vocabulary books and return JSON only. No prose, no markdown fences.';

export const PHONICS_SYSTEM =
  'You are a phonics teacher for Korean elementary students. Return JSON only.';

const REGION_LINE = {
  all: '이 페이지의 영단어 항목을 모두 뽑아줘.',
  top: '이 페이지의 위쪽 절반에 있는 영단어 항목만 뽑아줘. 아래쪽 절반은 무시해.',
  bottom: '이 페이지의 아래쪽 절반에 있는 영단어 항목만 뽑아줘. 위쪽 절반은 무시해.',
};

/**
 * 단어 추출 프롬프트. region 은 응답이 잘렸을 때 상/하반부로 나눠 다시 물을 때 쓴다.
 * @param {'all'|'top'|'bottom'} region
 */
export function wordsPrompt(region = 'all') {
  const lead = REGION_LINE[region] ?? REGION_LINE.all;
  return (
    lead +
    '\n' +
    'word: 영어 표제어\n' +
    'meaning: 책에 적힌 한국어 뜻 (짧게, 품사 표시는 빼고)\n' +
    'chunks: 발음 덩어리로 나눈 배열. 이어붙이면 word와 글자가 정확히 같아야 함.\n' +
    '형식: {"words":[{"word":"creature","meaning":"생명체","chunks":["crea","ture"]}]}\n' +
    'JSON만 출력.'
  );
}

export function phonicsPrompt(words) {
  const list = (words ?? []).map((w) => w.word).join(', ');
  return (
    '단어: ' + list + '\n\n' +
    '이 목록에서 초등 4학년이 배우면 좋을 공통 파닉스 규칙을 최대 5개 뽑아줘. 목록에 2개 이상 해당되는 단어가 있는 규칙을 우선.\n' +
    '규칙 하나 = 글자 조합 하나 = 소리 하나. "자음 블렌드", "자음 뭉치"처럼 여러 소리를 한 규칙으로 묶지 마.\n' +
    '규칙 하나에는 그 글자가 실제로 들어 있는 단어만 넣어. 억지로 채우지 말고, 맞는 단어가 없으면 규칙이 5개보다 적어도 괜찮아.\n' +
    'pattern: 규칙 이름 (예: -ture, -tion, igh, 매직 e)\n' +
    'letters: 단어 안에서 확인할 영문자 조각. 최대 2개, 각 2~5글자, 소문자. 모음 사이 자음 하나는 _ (예: ["ture"], ["tion","sion"], ["a_e"])\n' +
    'sound: 한글로 쓴 소리 하나 (예: 처). 쉼표로 여러 소리를 적지 마.\n' +
    'tip: 초등학생에게 하는 한 문장 설명\n' +
    'words: 목록 중 letters 가 실제로 들어 있는 단어들 (목록에 있는 철자 그대로)\n' +
    '형식: {"phonics":[{"pattern":"-ture","letters":["ture"],"sound":"처","tip":"...","words":["creature"]}]}\n' +
    'JSON만 출력.'
  );
}

/* ── 응답 해석 ──────────────────────────────────────────────────── */

/** Message 응답의 text 블록을 이어붙인다 */
export function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * 단어 추출 응답 해석.
 * status: 'ok' | 'truncated' | 'refused' | 'unparsable'
 * - truncated: stop_reason 이 max_tokens. words 에는 건진 만큼만 들어 있다(대개 빈 배열)
 * - refused: 안전 분류기가 거절. 재시도해도 같으므로 호출 측에서 중단
 * - unparsable: JSON 을 복구하지 못함. 한 번 더 시도할 가치가 있음
 */
export function parseWordsResponse(message) {
  if (!message || typeof message !== 'object') return { status: 'unparsable', words: [] };
  if (message.stop_reason === 'refusal') return { status: 'refused', words: [] };

  const parsed = extractJson(messageText(message));
  // 뜻이 빈 항목은 여기서 버리지 않고 검수 화면에서 표시한다 (단어를 조용히 잃지 않기 위해)
  const words = sanitizeWords(parsed?.words, { keepEmptyMeaning: true });

  if (message.stop_reason === 'max_tokens') return { status: 'truncated', words };
  if (!parsed) return { status: 'unparsable', words: [] };
  return { status: 'ok', words };
}

/* ── 파닉스 규칙 ↔ 단어 대조 ─────────────────────────────────────── */

/** 한 규칙이 가질 수 있는 글자 조각 수. 이보다 많으면 여러 규칙을 묶은 것으로 본다 */
export const MAX_LETTER_TOKENS = 3;

/**
 * 확인용 글자 조각 정리. 소문자 영문자와 _ 만 남기고, 실제 글자 2~5개인 조각만 유효하다.
 * (1글자는 어디에나 있어서 의미가 없고, 6글자 이상은 단어를 통째로 넘긴 것이다)
 * letters 가 없으면 pattern 문자열에서 영문자 덩어리를 뽑아 대신 쓴다 ("-tion / -sion" → ["tion","sion"]).
 * (예전에 저장된 단어장에는 letters 가 없다)
 */
export function normalizeLetters(letters, pattern) {
  const src =
    Array.isArray(letters) && letters.length ? letters : String(pattern ?? '').split(/[^a-zA-Z_]+/);
  const out = [];
  for (const raw of src) {
    const t = String(raw ?? '').toLowerCase().replace(/[^a-z_]/g, '');
    const real = t.replace(/_/g, '').length;
    if (real >= 2 && real <= 5 && !out.includes(t)) out.push(t);
  }
  return out;
}

/** "크르, 클, 브르" 처럼 소리를 여러 개 적었으면 여러 규칙을 묶은 것이다 */
export function isSingleSound(sound) {
  return !/[,/·]/.test(String(sound ?? ''));
}

/** 조각을 정규식으로. "a_e" 의 _ 는 자음 하나 */
export function letterRegex(token) {
  const body = String(token)
    .split('')
    .map((c) => (c === '_' ? '[b-df-hj-np-tv-z]' : c))
    .join('');
  return new RegExp(body, 'g');
}

/** 단어 안에 조각 중 하나라도 있는가. letters 가 비어 있으면 확인할 수 없으므로 true */
export function wordMatchesLetters(word, letters) {
  if (!Array.isArray(letters) || letters.length === 0) return true;
  const w = String(word ?? '').toLowerCase().replace(/\s/g, '');
  return letters.some((t) => letterRegex(t).test(w));
}

/**
 * 덩어리별 형광 표시. 조각이 걸리는 글자 범위와 겹치는 덩어리를 true 로.
 * ["ma","te","ri","al"] 에 ["ter"] → [false,true,true,false]
 */
export function highlightChunks(chunks, letters) {
  const list = Array.isArray(chunks) ? chunks.map((c) => String(c)) : [];
  const marks = list.map(() => false);
  const tokens = Array.isArray(letters) ? letters : [];
  if (tokens.length === 0) return marks;
  const joined = list.join('').toLowerCase();
  const starts = [];
  let pos = 0;
  for (const c of list) {
    starts.push(pos);
    pos += c.length;
  }
  for (const t of tokens) {
    const re = letterRegex(t);
    let m;
    while ((m = re.exec(joined)) !== null) {
      const a = m.index;
      const b = a + m[0].length;
      list.forEach((c, i) => {
        const s = starts[i];
        if (s < b && s + c.length > a) marks[i] = true;
      });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return marks;
}

/**
 * 파닉스 규칙 정리.
 * - pattern/sound 가 비면 버린다
 * - 소리가 여러 개거나 글자 조각이 MAX_LETTER_TOKENS 를 넘으면 버린다 (여러 규칙을 묶은 "블렌드" 류)
 * - 단어장에 없는 단어는 뺀다 (철자는 단어장 기준으로 맞춘다)
 * - letters 가 실제로 들어 있지 않은 단어는 뺀다 (모델이 억지로 채운 것)
 * - 남는 단어가 없는 규칙은 버린다. 최대 5개
 */
export function sanitizePhonics(raw, words) {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map((words ?? []).map((w) => [String(w.word).toLowerCase().trim(), w.word]));
  const out = [];
  for (const item of raw) {
    const pattern = String(item?.pattern ?? '').trim();
    const sound = String(item?.sound ?? '').trim();
    const tip = String(item?.tip ?? '').trim();
    if (!pattern || !sound) continue;
    if (!isSingleSound(sound)) continue;
    const letters = normalizeLetters(item?.letters, pattern);
    if (letters.length > MAX_LETTER_TOKENS) continue;
    const seen = new Set();
    const matched = [];
    for (const w of Array.isArray(item?.words) ? item.words : []) {
      const canonical = byKey.get(String(w ?? '').toLowerCase().trim());
      if (!canonical || seen.has(canonical)) continue;
      if (!wordMatchesLetters(canonical, letters)) continue;
      seen.add(canonical);
      matched.push(canonical);
    }
    if (matched.length === 0) continue;
    out.push({ pattern, letters, sound, tip, words: matched });
    if (out.length === 5) break;
  }
  return out;
}

/** 파닉스 응답 해석. 실패해도 학습은 이어져야 하므로 항상 배열을 돌려준다 */
export function parsePhonicsResponse(message, words) {
  if (!message || message.stop_reason === 'refusal') return { status: 'refused', phonics: [] };
  const parsed = extractJson(messageText(message));
  if (!parsed) return { status: 'unparsable', phonics: [] };
  return {
    status: message.stop_reason === 'max_tokens' ? 'truncated' : 'ok',
    phonics: sanitizePhonics(parsed.phonics, words),
  };
}

/** 여러 번의 추출 결과 합치기 (중복 단어는 먼저 나온 것을 남긴다). 뜻이 빈 항목도 검수를 위해 남긴다 */
export function mergeWords(...batches) {
  return sanitizeWords(batches.flat(), { keepEmptyMeaning: true });
}

/* ── 검수 화면용 신뢰도 표시 ─────────────────────────────────────── */

/**
 * 각 단어의 의심 항목을 돌려준다. 입력과 같은 길이의 배열, 원소는 플래그 문자열 배열.
 *  empty-word       단어가 비었음
 *  empty-meaning    뜻이 비었음
 *  short-meaning    뜻이 한 글자
 *  dup-meaning      같은 뜻이 다른 단어에도 붙어 있음
 *  chunk-mismatch   덩어리를 이어붙이면 단어와 다름 (저장 시 [word] 로 대체됨)
 *  chunk-fallback   6글자 이상인데 덩어리가 1개 (추출이 나누지 못한 것)
 */
export function flagWords(words) {
  const list = Array.isArray(words) ? words : [];
  const normMeaning = (m) => String(m ?? '').trim();
  const meaningCount = new Map();
  for (const w of list) {
    const m = normMeaning(w?.meaning);
    if (m) meaningCount.set(m, (meaningCount.get(m) ?? 0) + 1);
  }
  return list.map((w) => {
    const flags = [];
    const word = String(w?.word ?? '').trim();
    const m = normMeaning(w?.meaning);
    if (!word) flags.push('empty-word');
    if (!m) flags.push('empty-meaning');
    else if ([...m].length <= 1) flags.push('short-meaning');
    if (m && meaningCount.get(m) > 1) flags.push('dup-meaning');
    const chunks = Array.isArray(w?.chunks) ? w.chunks : [];
    if (word && !chunksMatch(word, chunks)) flags.push('chunk-mismatch');
    else if (word && chunks.length <= 1 && word.replace(/\s/g, '').length >= 6) flags.push('chunk-fallback');
    return flags;
  });
}
