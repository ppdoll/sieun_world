// src/storage.js
// 단어장·지문 목록의 localStorage 읽기/쓰기.
// 목록 조작 자체는 shared/wordsets.mjs, shared/passagesets.mjs 의 순수 함수가 맡는다.

import { migrateLegacy } from '../shared/wordsets.mjs';

const LIST_KEY = 'wordlab:sets';
const LEGACY_KEY = 'wordlab:current'; // 예전: 단어장 하나만 저장하던 키
const PASSAGE_KEY = 'wordlab:passages';

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패해도 학습은 계속 */
  }
}

export function saveWordSets(list) {
  writeJson(LIST_KEY, list);
}

/** 목록을 읽는다. 예전 형식이 남아 있으면 목록으로 옮기고 지운다 */
export function loadWordSets() {
  const list = readJson(LIST_KEY);
  const legacy = readJson(LEGACY_KEY);
  const merged = migrateLegacy(Array.isArray(list) ? list : [], legacy);
  if (legacy) {
    saveWordSets(merged);
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* 무시 */
    }
  }
  return merged;
}

export function savePassageSets(list) {
  writeJson(PASSAGE_KEY, list);
}

export function loadPassageSets() {
  const list = readJson(PASSAGE_KEY);
  return Array.isArray(list) ? list : [];
}

const PICK_LANG_KEY = 'wordlab:lang';

/** 사진 올리기에서 마지막으로 고른 단어장 종류. 'ko' 한글 뜻 | 'en' 영어 풀이 */
export function loadPickLang() {
  try {
    return readJson(PICK_LANG_KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}

export function savePickLang(lang) {
  writeJson(PICK_LANG_KEY, lang === 'en' ? 'en' : 'ko');
}
