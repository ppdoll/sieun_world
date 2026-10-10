// shared/definition-logic.mjs
// 영어 풀이 단어장(영영)을 사진에서 읽은 뒤 정리하는 순수 로직.
// 채점(gradeDefinition)과 낱말 나누기는 shared/wordlab-logic.mjs 에 있다. 여기서는 그것을 가져다 쓰기만 한다.

import { tokenizeText, stemWord, wordForms, autoKeys, STOPWORDS } from './wordlab-logic.mjs';

export const MAX_KEYS = 4;

/** 단어장 종류. 'ko' 한글 뜻 | 'en' 영어 풀이. 모르는 값은 예전 단어장처럼 'ko' */
export function normLang(x) {
  return x === 'en' ? 'en' : 'ko';
}

const POS_PREFIX = /^\s*(?:n|v|adj|adv|a|ad|conj|prep|pron|int|num|det|phr)\s*\.\s*/i;

/** 풀이 문장 정리: 앞에 붙은 품사 표시(conj. n. adj.)를 떼고 공백을 줄인다 */
export function cleanDefinition(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(POS_PREFIX, '')
    .trim();
}

/**
 * 모델이 고른 핵심 낱말을 검증한다.
 * - 풀이에 실제로 쓰인 낱말만 남긴다 (변화형은 같게 본다). 지어낸 낱말로 채점하지 않기 위해서다
 * - 표제어와 불용어는 뺀다. 표제어는 문제에 보이고, 불용어는 빠져도 뜻이 통한다
 * - 하나도 안 남으면 풀이에서 자동으로 고른다
 */
export function sanitizeKeys(keys, definition, headword, max = MAX_KEYS) {
  const defStems = new Set(tokenizeText(definition).map(stemWord));
  const headStems = new Set(wordForms(headword).flatMap((f) => tokenizeText(f)).map(stemWord));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(keys) ? keys : []) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    const toks = tokenizeText(text);
    if (toks.length === 0) continue;
    if (toks.every((t) => STOPWORDS.has(t))) continue;
    const stems = toks.map(stemWord);
    if (stems.some((s) => headStems.has(s))) continue;
    if (!stems.every((s) => defStems.has(s))) continue;
    const id = stems.join(' ');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(text);
    if (out.length >= max) break;
  }
  return out.length ? out : autoKeys(definition, headword, 3);
}

/** 영어 풀이 단어 목록 정리. sanitizeWords 를 지난 뒤에 쓴다 */
export function sanitizeDefinitionWords(words) {
  return (Array.isArray(words) ? words : []).map((w) => {
    const meaning = cleanDefinition(w.meaning);
    return { ...w, meaning, keys: sanitizeKeys(w.keys, meaning, w.word) };
  });
}

/**
 * 뜻이 한글인지 영어인지 본다. 사진을 고를 때 종류를 잘못 골랐는지 알려주기 위해서다.
 * 뜻의 절반 넘게 한글이 들어 있으면 'ko'
 */
export function detectMeaningLang(words) {
  const list = (Array.isArray(words) ? words : []).filter((w) => String(w?.meaning ?? '').trim());
  if (list.length === 0) return 'ko';
  const ko = list.filter((w) => /[가-힣]/.test(w.meaning)).length;
  return ko * 2 > list.length ? 'ko' : 'en';
}
