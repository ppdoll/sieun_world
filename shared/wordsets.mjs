// shared/wordsets.mjs
// 저장된 단어장 목록을 다루는 순수 함수. 최근 것이 앞에 오고 최대 MAX_WORDSETS 개만 남긴다.
// localStorage 읽기/쓰기는 src/storage.js 가 맡는다.

export const MAX_WORDSETS = 20; // 이 기기(localStorage)
export const MAX_REMOTE_WORDSETS = 5; // 공유 저장(git data 브랜치). 다른 기기에서 받아간다

/** 최근 활동 시각: 만든 때와 이 기기에서 마지막으로 공부한 때 중 늦은 쪽. 정렬과 잘라내기 기준 */
export function activityAt(set) {
  return Math.max(Number(set?.at) || 0, Number(set?.lastStudiedAt) || 0);
}

/** 최근 활동 순으로 정렬한 새 배열 */
export function sortByActivity(list) {
  return [...(Array.isArray(list) ? list : [])].filter(Boolean).sort((a, b) => activityAt(b) - activityAt(a));
}

/** 새 단어장 객체. id 는 시각 + 난수. */
export function makeWordSet(words, phonics = [], at = Date.now(), rand = Math.random()) {
  return {
    id: String(at) + '-' + Math.floor(rand * 1e6).toString(36),
    at,
    words: Array.isArray(words) ? words : [],
    phonics: Array.isArray(phonics) ? phonics : [],
  };
}

/** 목록 맨 앞에 넣고, 활동이 가장 오래된 것부터 잘라낸다 */
export function addWordSet(list, set, max = MAX_WORDSETS) {
  const rest = (Array.isArray(list) ? list : []).filter((s) => s && s.id !== set.id);
  return sortByActivity([set, ...rest]).slice(0, max);
}

/** 이 기기에서 공부했다고 표시한다. 공유에서 받아온 단어장도 이걸로 이 기기 것이 된다 */
export function markStudied(list, id, at = Date.now()) {
  return updateWordSet(list, id, { lastStudiedAt: at });
}

/** 여러 단어장을 하나로 묶는다. 같은 단어는 먼저 온 것만, 규칙은 pattern 이 같으면 하나만, 연상은 합친다 */
export function combineWordSets(sets) {
  const list = (Array.isArray(sets) ? sets : []).filter(Boolean);
  const seenWord = new Set();
  const words = [];
  const seenPattern = new Set();
  const phonics = [];
  const mnemonics = {};
  for (const s of list) {
    for (const w of Array.isArray(s.words) ? s.words : []) {
      const key = String(w?.word ?? '').toLowerCase().trim();
      if (!key || seenWord.has(key)) continue;
      seenWord.add(key);
      words.push(w);
    }
    for (const p of Array.isArray(s.phonics) ? s.phonics : []) {
      const key = String(p?.pattern ?? '').toLowerCase().trim();
      if (!key || seenPattern.has(key)) continue;
      seenPattern.add(key);
      phonics.push(p);
    }
    if (s.mnemonics && typeof s.mnemonics === 'object') {
      for (const [w, tip] of Object.entries(s.mnemonics)) if (tip && !mnemonics[w]) mnemonics[w] = tip;
    }
  }
  return { words, phonics, mnemonics, count: list.length };
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
 * - 같은 id 는 내용은 공유 저장 쪽을 믿되(다른 기기에서 규칙을 다시 뽑았을 수 있다),
 *   이 기기에서 공부한 기록(lastStudiedAt)은 남긴다
 * - 공유에서 온 것은 synced: true 로 표시한다
 * - 최근 활동 순, 최대 max 개
 */
export function mergeWordSets(local, remote, max = MAX_WORDSETS) {
  const byId = new Map();
  for (const s of Array.isArray(local) ? local : []) if (s && s.id) byId.set(s.id, s);
  for (const s of Array.isArray(remote) ? remote : []) {
    if (!s || !s.id) continue;
    const mine = byId.get(s.id);
    byId.set(s.id, { ...s, synced: true, ...(mine?.lastStudiedAt ? { lastStudiedAt: mine.lastStudiedAt } : {}) });
  }
  return sortByActivity([...byId.values()]).slice(0, max);
}

/**
 * 공유 저장에 넣기 전 정리. 화면 전용 표시(synced)와 모르는 필드는 버린다.
 * words/phonics 가 배열이 아니거나 id 가 없으면 null.
 */
export function toRemoteWordSet(set) {
  if (!set || typeof set.id !== 'string' || !set.id) return null;
  if (!Array.isArray(set.words) || set.words.length === 0) return null;
  const mnemonics =
    set.mnemonics && typeof set.mnemonics === 'object' && !Array.isArray(set.mnemonics)
      ? Object.fromEntries(Object.entries(set.mnemonics).slice(0, 100))
      : {};
  return {
    id: set.id,
    at: Number(set.at) || Date.now(),
    words: set.words.slice(0, 100),
    phonics: Array.isArray(set.phonics) ? set.phonics.slice(0, 5) : [],
    mnemonics,
    story: typeof set.story === 'string' ? set.story.slice(0, 600) : '',
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
