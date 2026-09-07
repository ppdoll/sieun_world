// shared/manual-entry.mjs
// 사진 없이 단어장을 직접 넣을 때, 여러 줄 텍스트를 단어 행으로 바꾼다.
//
//   creature 생명체
//   crea-ture 생명체           ← 단어의 - 는 덩어리 경계 (crea / ture)
//   co-ral reef, 산호초        ← 띄어쓰기는 단어의 일부로 남는다
//   03  brightly  ad. 밝게, 선명하게   ← 앞 번호와 품사 표시는 뗀다
//   scissors<TAB>가위

const POS_TAG = /^(n|v|a|ad|adj|adv|prep|conj|pron|int|숙|명|동|형|부)\.\s*/i;

/** 한 줄 → { word, meaning, chunks } 또는 null(비었거나 영어 단어가 없음) */
export function parseWordLine(raw) {
  let line = String(raw ?? '')
    .trim()
    .replace(/^\d+\s*[.)]?\s*/, ''); // 앞 번호
  if (!line) return null;

  // 첫 비-ASCII(한글) 글자 앞까지가 단어. 없으면 탭/쉼표/' - ' 로 나눈다
  let idx = line.search(/[^\x00-\x7F]/);
  let wordPart;
  let meaning;
  if (idx > 0) {
    wordPart = line.slice(0, idx);
    meaning = line.slice(idx);
  } else {
    const m = line.match(/^(.+?)(?:\t+|\s*,\s*|\s+-\s+|\s*:\s*)(.+)$/);
    if (m) {
      wordPart = m[1];
      meaning = m[2];
    } else {
      wordPart = line;
      meaning = '';
    }
  }
  // 단어 뒤에 붙은 구분자와 영문 품사 표시("brightly ad.", "recognize: v.")를 뗀다
  wordPart = wordPart
    .replace(/[\s\t,:=|]+$/, '')
    .replace(/\s*\b(n|v|a|ad|adj|adv|prep|conj|pron|int)\.$/i, '')
    .replace(/[\s\t,:=|]+$/, '')
    .trim();
  meaning = meaning.replace(/^[\s\t,:=|-]+/, '').replace(POS_TAG, '').trim();
  if (!/[A-Za-z]/.test(wordPart)) return null;

  const chunks = wordPart
    .split('-')
    .map((s) => s.trim())
    .filter(Boolean);
  const word = chunks.join('');
  return { word, meaning, chunks: chunks.length > 1 ? chunks : [word] };
}

/** 여러 줄 → 행 배열. 빈 줄과 영어가 없는 줄은 건너뛴다 */
export function parseWordLines(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const row = parseWordLine(raw);
    if (row) out.push(row);
  }
  return out;
}
