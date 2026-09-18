// shared/passagesets.mjs
// 저장된 지문 목록. 목록을 다루는 함수(addWordSet, removeWordSet, updateWordSet, findWordSet,
// sortByActivity, markStudied)는 { id, at, lastStudiedAt } 모양이면 그대로 쓸 수 있어
// shared/wordsets.mjs 것을 함께 쓴다. 여기에는 지문에만 있는 것을 둔다.

export const MAX_PASSAGE_SETS = 20;

/** 새 지문 묶음 */
export function makePassageSet({ title, passage, sentences, questions }, at = Date.now(), rand = Math.random()) {
  return {
    id: 'p' + at + '-' + Math.floor(rand * 1e6).toString(36),
    at,
    title: String(title ?? '').trim(),
    passage: String(passage ?? ''),
    sentences: Array.isArray(sentences) ? sentences : [],
    questions: Array.isArray(questions) ? questions : [],
  };
}

/** 화면에 보일 제목: "9월 18일 · The Mantis Shrimp" */
export function passageSetTitle(set) {
  const d = new Date(set?.at ?? 0);
  const date = d.getMonth() + 1 + '월 ' + d.getDate() + '일';
  const title = String(set?.title ?? '').trim();
  if (title) return date + ' · ' + title;
  const first = String(set?.passage ?? '').trim().split(/\s+/).slice(0, 5).join(' ');
  return first ? date + ' · ' + first + '…' : date;
}

/** 근거가 검증돼서 "근거 문장 찾기" 에 쓸 수 있는 문제 수 */
export function verifiedCount(set) {
  return (Array.isArray(set?.questions) ? set.questions : []).filter((q) => q?.verified).length;
}
