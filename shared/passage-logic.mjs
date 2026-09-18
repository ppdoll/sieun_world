// shared/passage-logic.mjs
// 독해 지문과 문제의 순수 로직. 모델을 직접 호출하지 않는다.
// 프롬프트 생성, 응답 해석, 그리고 무엇보다 "근거 문장이 지문에 실제로 있는가" 검증.

import { extractJson } from './wordlab-logic.mjs';
import { messageText } from './extract-logic.mjs';

export const MAX_PASSAGE_CHARS = 4000;
export const MAX_QUESTIONS = 20;
export const OPTION_COUNT = 4;

/** 시험에 반복해서 나오는 문제 유형. 라벨은 화면과 검수에 그대로 쓴다 */
export const QUESTION_TYPES = {
  main: '주제',
  blank: '빈칸',
  true: '일치',
  nottrue: '불일치',
  detail: '세부',
  intent: '의도',
};

/**
 * 근거 문장을 지문과 대조할 수 없는 유형.
 * 주제와 의도는 글 전체에서 나오는 답이라 한 문장으로 짚을 수 없다. 검수 화면에서 따로 표시한다.
 */
export const UNVERIFIABLE_TYPES = new Set(['main', 'intent']);

/* ── 응답 스키마 ────────────────────────────────────────────────── */

const QUESTION_ITEM = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: Object.keys(QUESTION_TYPES) },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    answer: { type: 'integer' },
    evidence: { type: 'string' },
  },
  required: ['type', 'question', 'options', 'answer', 'evidence'],
  additionalProperties: false,
};

export const PASSAGE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    passage: { type: 'string' },
    questions: { type: 'array', items: QUESTION_ITEM },
  },
  required: ['title', 'passage', 'questions'],
  additionalProperties: false,
};

export const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: { questions: { type: 'array', items: QUESTION_ITEM } },
  required: ['questions'],
  additionalProperties: false,
};

export const PASSAGE_SYSTEM =
  'You read photos of English reading-comprehension textbook pages for Korean elementary students and return JSON only. ' +
  'Read only the printed text. Ignore handwriting, pencil marks, underlines, circles, and Korean notes written by the student.';

export const QUESTIONS_SYSTEM =
  'You write reading-comprehension questions for Korean elementary students, in the style of their school test. Return JSON only.';

/* ── 프롬프트 ──────────────────────────────────────────────────── */

const QUESTION_RULES =
  'type: main(글 전체 주제) | blank(빈칸에 알맞은 말) | true(내용과 맞는 것) | nottrue(내용과 다른 것) | detail(세부 내용) | intent(글쓴이가 왜 그 말을 썼나)\n' +
  'question: 영어 질문 한 문장\n' +
  'options: 영어 보기 정확히 4개. 서로 겹치지 않게\n' +
  'answer: 정답인 보기의 번호 (0부터 시작)\n' +
  'evidence: 그 답의 근거가 되는 지문 문장 하나를 글자 그대로 옮겨 적기.\n' +
  '          지문에 없는 문장을 지어내지 말 것. main 과 intent 는 가장 가까운 문장 하나를 적는다.\n';

/** 사진 → 지문 + 교재에 인쇄된 문제 */
export function passagePrompt() {
  return (
    '이 페이지의 읽기 지문과 객관식 문제를 뽑아줘.\n' +
    '연필로 쓴 글씨, 밑줄, 동그라미, 한글 메모는 무시하고 인쇄된 글자만 읽어.\n\n' +
    'title: 지문 제목 (없으면 빈 문자열)\n' +
    'passage: 지문 본문 전체를 그대로. 문단이 나뉘면 빈 줄로 구분. 문제와 보기는 넣지 말 것\n' +
    'questions: 이 페이지에 인쇄된 객관식 문제. 없으면 빈 배열\n' +
    QUESTION_RULES +
    '\n정답이 인쇄되어 있지 않으면 지문을 읽고 직접 고른다.\n' +
    'JSON만 출력.'
  );
}

/**
 * 지문 → 모의 문제. 실제 시험이 늘 같은 여섯 유형으로 나오므로 그 모양을 그대로 요구한다.
 * @param {string} passage
 * @param {string[]} avoid 이미 있는 질문들 (겹치지 않게)
 */
export function questionsPrompt(passage, avoid = []) {
  const already = avoid.length ? '\n이미 있는 문제와 겹치지 않게 해줘:\n' + avoid.map((q) => '- ' + q).join('\n') + '\n' : '';
  return (
    '지문:\n' + passage + '\n\n' +
    '이 지문으로 초등 4학년 영어 독해 시험 문제를 10개 만들어줘. 학교 시험과 같은 모양으로.\n' +
    '유형별 개수: main 2개, blank 2개, nottrue 2개, detail 2개, true 1개, intent 1개\n' +
    already +
    QUESTION_RULES +
    '\nblank 는 지문에서 한 낱말을 빈칸으로 만든 문제다. question 에 그 문장을 쓰고 빈칸 자리를 ___ 로 적는다.\n' +
    '오답 보기는 지문에 나오는 다른 낱말로 만들어 그럴듯하게. 지문에 없는 어려운 낱말은 쓰지 말 것.\n' +
    'JSON만 출력.'
  );
}

/* ── 지문 정리 ─────────────────────────────────────────────────── */

/** 지문 텍스트 정리: 줄바꿈은 문단 구분만 남기고, 줄 끝에서 잘린 낱말을 잇는다 */
export function cleanPassage(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n\n')
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_PASSAGE_CHARS)
    .trim();
}

/**
 * 지문을 문장으로 나눈다. 마침표·물음표·느낌표 뒤에 공백이 오는 자리에서 끊는다.
 * 공백을 요구하므로 3.5 같은 소수점은 애초에 끊기지 않는다. Mr. 같은 줄임말만 따로 막는다.
 */
export function splitSentences(passage) {
  const text = cleanPassage(passage).replace(/\n+/g, ' ');
  if (!text) return [];
  const out = [];
  let buf = '';
  for (const part of text.split(/(?<=[.!?])(?=\s)/)) {
    buf += part;
    const trimmed = buf.trim();
    if (/\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\.$/i.test(trimmed)) continue; // 줄임말 뒤는 아직 안 끝났다
    if (/[.!?]$/.test(trimmed)) {
      out.push(trimmed);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* ── 근거 문장 검증 ─────────────────────────────────────────────── */

/** 대조용 정규화: 소문자, 따옴표 통일, 공백 축약, 앞뒤 문장부호 제거 */
export function normalizeForMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'.,;:!?()\[\]-]+|[\s"'.,;:!?()\[\]-]+$/g, '')
    .trim();
}

export const MIN_EVIDENCE_CHARS = 12;

/**
 * 근거 문장이 지문의 어느 문장인지 찾는다. 없으면 -1.
 * 모델이 문장의 일부만 인용해도 그 문장을 찾아준다. 너무 짧은 인용은 우연히 맞을 수 있어 받지 않는다.
 */
export function findSentence(sentences, evidence) {
  const needle = normalizeForMatch(evidence);
  if (needle.length < MIN_EVIDENCE_CHARS) return -1;
  const list = Array.isArray(sentences) ? sentences : [];
  const norm = list.map(normalizeForMatch);
  const exact = norm.indexOf(needle);
  if (exact !== -1) return exact;
  return norm.findIndex((s) => s.includes(needle));
}

/* ── 문제 정리 ─────────────────────────────────────────────────── */

const cleanOption = (o) =>
  String(o ?? '')
    .replace(/^\s*[a-dA-D]\s*[.)]\s*/, '') // "a. " 같은 보기 번호
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 문제 검증. 하나라도 어긋나면 그 문제를 버린다.
 * - 질문과 보기가 있어야 하고, 보기는 정확히 4개에 서로 달라야 한다
 * - 정답 번호가 보기 범위 안이어야 한다
 * - 근거 문장이 지문에 실제로 있어야 한다 (주제·의도는 예외: verified=false 로 남기고 검수에서 본다)
 *
 * @returns {{questions: Array, dropped: number}}
 */
export function sanitizeQuestions(raw, sentences) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  let dropped = 0;
  for (const item of list) {
    if (out.length >= MAX_QUESTIONS) break;
    const question = String(item?.question ?? '').replace(/\s+/g, ' ').trim();
    const type = QUESTION_TYPES[item?.type] ? item.type : 'detail';
    const options = (Array.isArray(item?.options) ? item.options : []).map(cleanOption).filter(Boolean);
    // 숫자이거나 "2" 같은 숫자 문자열만 받는다. Number(null) 이 0 이라 그냥 두면
    // 정답이 빠진 문제가 "첫 보기가 정답" 으로 둔갑한다
    const rawAnswer = item?.answer;
    const answer =
      typeof rawAnswer === 'number'
        ? rawAnswer
        : typeof rawAnswer === 'string' && rawAnswer.trim() !== ''
          ? Number(rawAnswer)
          : NaN;

    if (!question || options.length !== OPTION_COUNT) {
      dropped++;
      continue;
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== OPTION_COUNT) {
      dropped++;
      continue;
    }
    if (!Number.isInteger(answer) || answer < 0 || answer >= OPTION_COUNT) {
      dropped++;
      continue;
    }
    const key = question.toLowerCase();
    if (seen.has(key)) {
      dropped++;
      continue;
    }

    const evidenceIndex = findSentence(sentences, item?.evidence);
    const verifiable = !UNVERIFIABLE_TYPES.has(type);
    if (verifiable && evidenceIndex === -1) {
      // 지문에 없는 문장을 근거로 댄 문제다. 지어냈을 가능성이 높으니 버린다
      dropped++;
      continue;
    }

    seen.add(key);
    out.push({
      type,
      question,
      options,
      answer,
      evidence: evidenceIndex === -1 ? '' : sentences[evidenceIndex],
      evidenceIndex,
      verified: evidenceIndex !== -1,
    });
  }
  return { questions: out, dropped };
}

/* ── 응답 해석 ─────────────────────────────────────────────────── */

/**
 * 사진 추출 응답 해석.
 * status: 'ok' | 'truncated' | 'refused' | 'unparsable' | 'empty'
 */
export function parsePassageResponse(message) {
  const empty = { title: '', passage: '', sentences: [], questions: [], dropped: 0 };
  if (!message || typeof message !== 'object') return { status: 'unparsable', ...empty };
  if (message.stop_reason === 'refusal') return { status: 'refused', ...empty };

  const parsed = extractJson(messageText(message));
  if (!parsed) {
    return { status: message.stop_reason === 'max_tokens' ? 'truncated' : 'unparsable', ...empty };
  }
  const passage = cleanPassage(parsed.passage);
  const sentences = splitSentences(passage);
  const { questions, dropped } = sanitizeQuestions(parsed.questions, sentences);
  const title = String(parsed.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

  if (!passage) return { status: message.stop_reason === 'max_tokens' ? 'truncated' : 'empty', ...empty };
  return {
    status: message.stop_reason === 'max_tokens' ? 'truncated' : 'ok',
    title,
    passage,
    sentences,
    questions,
    dropped,
  };
}

/** 모의 문제 응답 해석. 실패해도 항상 배열을 돌려준다 */
export function parseQuestionsResponse(message, sentences) {
  if (!message || message.stop_reason === 'refusal') return { status: 'refused', questions: [], dropped: 0 };
  const parsed = extractJson(messageText(message));
  if (!parsed) {
    return { status: message.stop_reason === 'max_tokens' ? 'truncated' : 'unparsable', questions: [], dropped: 0 };
  }
  const { questions, dropped } = sanitizeQuestions(parsed.questions, sentences);
  return { status: message.stop_reason === 'max_tokens' ? 'truncated' : 'ok', questions, dropped };
}

/** 같은 질문은 하나만 남기고 합친다 (교재 문제 + 모의 문제) */
export function mergeQuestions(...batches) {
  const seen = new Set();
  const out = [];
  for (const q of batches.flat()) {
    if (!q || !q.question) continue;
    const key = q.question.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/* ── 검수 화면용 표시 ───────────────────────────────────────────── */

/**
 * 문제마다 부모가 확인해야 할 점.
 *  unverified     근거 문장을 지문과 대조하지 못함 (주제·의도)
 *  long-option    보기가 지나치게 김 (지문 한 문장을 통째로 옮긴 것일 수 있음)
 *  answer-first   정답이 늘 첫 보기 (섞이지 않은 문제)
 */
export function flagQuestions(questions) {
  const list = Array.isArray(questions) ? questions : [];
  return list.map((q) => {
    const flags = [];
    if (!q.verified) flags.push('unverified');
    if (q.options?.some((o) => o.length > 70)) flags.push('long-option');
    return flags;
  });
}

/* ── 지문 안의 아는 단어 표시 ───────────────────────────────────── */

/**
 * 저장된 단어장들에서 { 소문자 단어 → 뜻 } 을 만든다.
 * 지문을 읽을 때 이미 검수를 거친 뜻만 보여주기 위한 것이라 모델을 부르지 않는다.
 */
export function buildWordIndex(sets) {
  const map = new Map();
  for (const set of Array.isArray(sets) ? sets : []) {
    for (const w of Array.isArray(set?.words) ? set.words : []) {
      const key = String(w?.word ?? '').toLowerCase().trim();
      const meaning = String(w?.meaning ?? '').trim();
      if (key && meaning && !map.has(key)) map.set(key, meaning);
    }
  }
  return map;
}

/**
 * 표제어의 흔한 변화형. 지문은 creatures, reefs, recognized 처럼 쓰는데
 * 단어장에는 원형만 있어서 그냥 맞추면 거의 안 걸린다.
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

/**
 * 문장을 조각으로 나눈다. 아는 단어는 뜻을 달아 표시한다.
 * [{ text }] 또는 [{ text, word, meaning }]
 * 긴 표제어(coral reef)와 긴 변화형을 먼저 맞추고, 단어 경계가 맞을 때만 잡는다.
 */
export function splitSentenceByWords(sentence, wordIndex) {
  const text = String(sentence ?? '');
  const map = wordIndex instanceof Map ? wordIndex : new Map();
  if (!text || map.size === 0) return text ? [{ text }] : [];

  // 변화형 → 원형. 같은 변화형이 여러 표제어에 걸리면 긴 표제어를 믿는다
  const byForm = new Map();
  for (const key of [...map.keys()].sort((a, b) => b.length - a.length)) {
    if (!/[a-z]/.test(key)) continue;
    for (const form of wordForms(key)) if (!byForm.has(form)) byForm.set(form, key);
  }
  if (byForm.size === 0) return [{ text }];

  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length);
  const escaped = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(?<![a-zA-Z])(' + escaped.join('|') + ')(?![a-zA-Z])', 'gi');

  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const base = byForm.get(m[1].toLowerCase());
    if (!base) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], word: base, meaning: map.get(base) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
