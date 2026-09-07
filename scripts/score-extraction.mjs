// scripts/score-extraction.mjs
// 추출 결과 JSON 파일들을 정답과 채점해 표로 보여준다. (compare-models.mjs 와 같은 기준)
//   node scripts/score-extraction.mjs test_img/result-sonnet.json test_img/result-haiku.json [--answers test_img/answers.json]
// 결과 파일 형식: { "words": [{ "word", "meaning", "chunks" }] }  — 사진 여러 장의 결과를 합친 것

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeWords, normalize, chunksMatch } from '../shared/wordlab-logic.mjs';

const args = process.argv.slice(2);
const ai = args.indexOf('--answers');
const answersPath = ai === -1 ? 'test_img/answers.json' : args.splice(ai, 2)[1];
const files = args;
if (files.length === 0) {
  console.error('사용: node scripts/score-extraction.mjs <result.json> [...] [--answers answers.json]');
  process.exit(1);
}

const truth = sanitizeWords(JSON.parse(fs.readFileSync(answersPath, 'utf8')).words);
const truthByKey = new Map(truth.map((w) => [normalize(w.word), w]));
const normMeaning = (m) => String(m ?? '').replace(/\s+/g, ' ').replace(/[.。]$/, '').trim();

function meaningMatch(got, want) {
  const g = normMeaning(got);
  const w = normMeaning(want);
  if (!g || !w) return 'miss';
  if (g === w) return 'exact';
  const gs = g.split(/[,;·/]/).map((s) => s.trim()).filter(Boolean);
  const ws = w.split(/[,;·/]/).map((s) => s.trim()).filter(Boolean);
  return gs.some((x) => ws.includes(x)) ? 'partial' : 'miss';
}

const pct = (a, b) => (b === 0 ? '-' : Math.round((a / b) * 100) + '%');
const rows = [];
const details = [];
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const merged = sanitizeWords(raw.words);
  let found = 0;
  let exact = 0;
  let partial = 0;
  let chunkSplit = 0;
  let chunkSame = 0;
  const wrong = [];
  const extra = [];
  const seen = new Set();
  for (const w of merged) {
    const t = truthByKey.get(normalize(w.word));
    if (!t) {
      extra.push(w.word);
      continue;
    }
    found++;
    seen.add(normalize(t.word));
    const m = meaningMatch(w.meaning, t.meaning);
    if (m === 'exact') exact++;
    else if (m === 'partial') partial++;
    else wrong.push(t.word + ': "' + w.meaning + '" (정답 "' + t.meaning + '")');
    if (w.chunks.length >= 2 && chunksMatch(w.word, w.chunks)) chunkSplit++;
    if (w.chunks.join('-').toLowerCase() === t.chunks.join('-').toLowerCase()) chunkSame++;
  }
  const missing = truth.filter((t) => !seen.has(normalize(t.word))).map((t) => t.word);
  const name = path.basename(f, '.json');
  rows.push({
    결과: name,
    '단어 찾음': found + '/' + truth.length,
    '뜻 완전 일치': pct(exact, found),
    '뜻 느슨 일치': pct(exact + partial, found),
    '뜻 틀림': found - exact - partial,
    '못 찾음': missing.length,
    '없는 단어': extra.length,
    '덩어리 나뉨': pct(chunkSplit, found),
    '덩어리 정답과 같음': pct(chunkSame, found),
  });
  details.push({ name, missing, extra, wrong });
}
console.table(rows);
for (const d of details) {
  console.log('\n## ' + d.name);
  if (d.missing.length) console.log('못 찾은 단어: ' + d.missing.join(', '));
  if (d.extra.length) console.log('정답에 없는 단어: ' + d.extra.join(', '));
  if (d.wrong.length) {
    console.log('뜻이 다른 것:');
    for (const w of d.wrong) console.log('  - ' + w);
  }
  if (!d.missing.length && !d.extra.length && !d.wrong.length) console.log('모두 일치');
}
