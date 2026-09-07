// shared/wordsets.mjs
// 저장된 단어장 목록을 다루는 순수 함수. 최근 것이 앞에 오고 최대 MAX_WORDSETS 개만 남긴다.
// localStorage 읽기/쓰기는 src/storage.js 가 맡는다.

export const MAX_WORDSETS = 10; // 이 기기(localStorage)
export const MAX_REMOTE_WORDSETS = 5; // 공유 저장(git data 브랜치). 다른 기기에서 받아간다

/** 새 단어장 객체. id 는 시각 + 난수. */
export function makeWordSet(words, phonics = [], at = Date.now(), rand = Math.random()) {
  return {
    id: String(at) + '-' + Math.floor(rand * 1e6).toString(36),
    at,
    words: Array.isArray(words) ? words : [],
    phonics: Array.isArray(phonics) ? phonics : [],
  };
}

/** 목록 맨 앞에 넣고 오래된 것은 잘라낸다 */
export function addWordSet(list, set, max = MAX_WORDSETS) {
  const rest = (Array.isArray(list) ? list : []).filter((s) => s && s.id !== set.id);
  return [set, ...rest].slice(0, max);
}

/** id 로 하나 지운다 */
export function removeWordSet(list, id) {
  return (Array.isArray(list) ? list : []).filter((s) => s && s.id !== id);
}

/** 규칙(또는 단어)을 바꾼 단어장을 같은 자리에 되돌려 놓는다 */
export function updateWordSet(list, id, patch) {
  return (Array.isArray(list) ? list : []).map((s) => (s && s.id === id ? { ...s, ...patch } : s));
}

/** 목록에서 하나 찾기 */
export function findWordSet(list, id) {
  return (Array.isArray(list) ? list : []).find((s) => s && s.id === id) ?? null;
}

/** 화면에 보일 제목: "9월 7일 · creature 외 9개" */
export function wordSetTitle(set) {
  const d = new Date(set?.at ?? 0);
  const date = d.getMonth() + 1 + '월 ' + d.getDate() + '일';
  const words = Array.isArray(set?.words) ? set.words : [];
  if (words.length === 0) return date;
  const first = words[0].word;
  return words.length === 1 ? date + ' · ' + first : date + ' · ' + first + ' 외 ' + (words.length - 1) + '개';
}

/**
 * 이 기기 목록과 공유 저장 목록을 합친다.
 * - 같은 id 는 공유 저장 쪽을 믿는다 (다른 기기에서 규칙을 다시 뽑았을 수 있다)
 * - 공유에서 온 것은 synced: true 로 표시한다
 * - 최근 것이 앞, 최대 max 개
 */
export function mergeWordSets(local, remote, max = MAX_WORDSETS) {
  const byId = new Map();
  for (const s of Array.isArray(local) ? local : []) if (s && s.id) byId.set(s.id, s);
  for (const s of Array.isArray(remote) ? remote : []) if (s && s.id) byId.set(s.id, { ...s, synced: true });
  return [...byId.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, max);
}

/**
 * 공유 저장에 넣기 전 정리. 화면 전용 표시(synced)와 모르는 필드는 버린다.
 * words/phonics 가 배열이 아니거나 id 가 없으면 null.
 */
export function toRemoteWordSet(set) {
  if (!set || typeof set.id !== 'string' || !set.id) return null;
  if (!Array.isArray(set.words) || set.words.length === 0) return null;
  return {
    id: set.id,
    at: Number(set.at) || Date.now(),
    words: set.words.slice(0, 100),
    phonics: Array.isArray(set.phonics) ? set.phonics.slice(0, 5) : [],
  };
}

/**
 * 예전 저장 형식(`wordlab:current` 하나짜리)을 목록으로 바꾼다.
 * 목록이 이미 있으면 그대로 두고, 없고 예전 것만 있으면 그것을 첫 항목으로 만든다.
 */
export function migrateLegacy(list, legacy) {
  if (Array.isArray(list) && list.length > 0) return list;
  if (!legacy || !Array.isArray(legacy.words) || legacy.words.length === 0) return Array.isArray(list) ? list : [];
  return [makeWordSet(legacy.words, legacy.phonics ?? [], legacy.at ?? Date.now(), 0)];
}
