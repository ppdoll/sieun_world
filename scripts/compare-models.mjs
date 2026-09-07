// scripts/compare-models.mjs
// 같은 사진을 여러 모델에 넣어 추출 정확도·속도·비용을 비교한다. 실제 앱과 같은 프롬프트와
// 4단계 검증(shared/extract-service.mjs)을 그대로 거친다.
//
//   node scripts/compare-models.mjs
//   node scripts/compare-models.mjs --models claude-opus-5,claude-sonnet-5 --dir test_img --skip-story
//
// 준비물
//   - 사진 폴더 (기본 test_img/). jpg/png/webp
//   - 정답 파일 (기본 <dir>/answers.json) : { words: [{ word, meaning, chunks }] } — 검수 화면에서 고친 최종본
//   - ANTHROPIC_API_KEY : 환경변수 또는 .env.local
// 결과는 콘솔 표 + <dir>/compare-<시각>.md 에 나란히 저장된다. 사진은 어디에도 업로드·저장되지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractWordsFromImage, extractPhonicsRules, extractStory } from '../shared/extract-service.mjs';
import { sanitizeWords, normalize, chunksMatch } from '../shared/wordlab-logic.mjs';
import { makeCallModel } from '../api/_lib/claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 설정 ─────────────────────────────────────────────────────── */

// 백만 토큰당 달러 (입력, 출력). 모르는 모델은 0 으로 두고 표에 '?' 를 찍는다
const PRICE = {
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'claude-fable-5-1': [10, 50],
};
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = (name) => process.argv.includes('--' + name);

const MODELS = arg('models', 'claude-opus-5,claude-sonnet-5,claude-haiku-4-5').split(',').map((s) => s.trim()).filter(Boolean);
const DIR = path.resolve(ROOT, arg('dir', 'test_img'));
const ANSWERS = path.resolve(ROOT, arg('answers', path.join(DIR, 'answers.json')));
const EFFORT = arg('effort', process.env.CLAUDE_EFFORT || 'medium');
const SKIP_STORY = flag('skip-story');
const SKIP_PHONICS = flag('skip-phonics');

/* ── .env.local (dotenv 없이) ──────────────────────────────────── */

for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('ANTHROPIC_API_KEY 가 없습니다. .env.local 에 적거나 환경변수로 넘겨주세요.');
  process.exit(1);
}

/* ── 입력 ─────────────────────────────────────────────────────── */

const photos = fs
  .readdirSync(DIR)
  .filter((f) => MIME[path.extname(f).toLowerCase()])
  .sort()
  .map((f) => ({
    name: f,
    image: { data: fs.readFileSync(path.join(DIR, f)).toString('base64'), mediaType: MIME[path.extname(f).toLowerCase()] },
  }));
if (photos.length === 0) {
  console.error('사진이 없습니다: ' + DIR);
  process.exit(1);
}
const truth = sanitizeWords(JSON.parse(fs.readFileSync(ANSWERS, 'utf8')).words);
const truthByKey = new Map(truth.map((w) => [normalize(w.word), w]));

/* ── 채점 ─────────────────────────────────────────────────────── */

const normMeaning = (m) => String(m ?? '').replace(/\s+/g, ' ').replace(/[.。]$/, '').trim();

/** 뜻이 같은가. 완전 일치 또는 쉼표로 나눈 뜻 중 하나가 정답에 들어 있으면 느슨한 일치 */
function meaningMatch(got, want) {
  const g = normMeaning(got);
  const w = normMeaning(want);
  if (!g || !w) return 'miss';
  if (g === w) return 'exact';
  const gs = g.split(/[,;·/]/).map((s) => s.trim()).filter(Boolean);
  const ws = w.split(/[,;·/]/).map((s) => s.trim()).filter(Boolean);
  return gs.some((x) => ws.includes(x)) ? 'partial' : 'miss';
}

function score(merged) {
  const found = [];
  const extra = [];
  for (const w of merged) {
    const t = truthByKey.get(normalize(w.word));
    if (t) found.push({ got: w, want: t });
    else extra.push(w.word);
  }
  const foundKeys = new Set(found.map((f) => normalize(f.want.word)));
  const missing = truth.filter((t) => !foundKeys.has(normalize(t.word))).map((t) => t.word);
  const meaning = { exact: 0, partial: 0, miss: 0, wrong: [] };
  let chunkSplit = 0;
  let chunkSame = 0;
  for (const f of found) {
    const m = meaningMatch(f.got.meaning, f.want.meaning);
    meaning[m]++;
    if (m === 'miss') meaning.wrong.push(f.want.word + ': "' + f.got.meaning + '" (정답 "' + f.want.meaning + '")');
    if (f.got.chunks.length >= 2 && chunksMatch(f.got.word, f.got.chunks)) chunkSplit++;
    if (f.got.chunks.join('-').toLowerCase() === f.want.chunks.join('-').toLowerCase()) chunkSame++;
  }
  return { found: found.length, missing, extra, meaning, chunkSplit, chunkSame };
}

/* ── 실행 ─────────────────────────────────────────────────────── */

const pct = (a, b) => (b === 0 ? '-' : Math.round((a / b) * 100) + '%');
const sec = (ms) => (ms / 1000).toFixed(1) + 's';

async function runModel(model) {
  const usage = { calls: 0, input: 0, output: 0, ms: 0 };
  const callModel = makeCallModel({
    model,
    effort: EFFORT,
    onResponse: (msg, meta) => {
      usage.calls++;
      usage.input += msg.usage?.input_tokens ?? 0;
      usage.output += msg.usage?.output_tokens ?? 0;
      usage.ms += meta.ms;
    },
  });

  const perPhoto = [];
  const all = [];
  for (const p of photos) {
    const started = Date.now();
    try {
      const r = await extractWordsFromImage({ image: p.image, callModel });
      perPhoto.push({ name: p.name, status: r.status, words: r.words.length, calls: r.calls, ms: Date.now() - started });
      all.push(...r.words);
    } catch (e) {
      perPhoto.push({ name: p.name, status: 'error: ' + (e.status ?? '') + ' ' + (e.message ?? e), words: 0, calls: 0, ms: Date.now() - started });
    }
  }
  const merged = sanitizeWords(all);
  const extractUsage = { ...usage };
  const s = score(merged);

  let phonics = null;
  if (!SKIP_PHONICS) {
    try {
      phonics = await extractPhonicsRules({ words: truth, callModel });
    } catch (e) {
      phonics = { error: String(e.message ?? e) };
    }
  }
  let story = null;
  if (!SKIP_STORY) {
    try {
      story = await extractStory({ words: truth, callModel });
    } catch (e) {
      story = { error: String(e.message ?? e) };
    }
  }

  const [pi, po] = PRICE[model] ?? [0, 0];
  const cost = (usage.input * pi + usage.output * po) / 1e6;
  const extractCost = (extractUsage.input * pi + extractUsage.output * po) / 1e6;
  return { model, perPhoto, merged, score: s, phonics, story, usage, extractUsage, cost, extractCost, priced: !!PRICE[model] };
}

console.log('사진 ' + photos.length + '장, 정답 단어 ' + truth.length + '개, 모델 ' + MODELS.join(', ') + ', effort ' + EFFORT);
const results = [];
for (const model of MODELS) {
  process.stdout.write('\n▶ ' + model + ' ');
  const r = await runModel(model);
  process.stdout.write('완료 (' + r.usage.calls + '회 호출, ' + sec(r.usage.ms) + ')\n');
  results.push(r);
}

/* ── 콘솔 표 ─────────────────────────────────────────────────── */

const rows = results.map((r) => ({
  모델: r.model,
  '단어 찾음': r.score.found + '/' + truth.length + ' (' + pct(r.score.found, truth.length) + ')',
  '뜻 정확(완전)': pct(r.score.meaning.exact, r.score.found),
  '뜻 정확(느슨)': pct(r.score.meaning.exact + r.score.meaning.partial, r.score.found),
  '뜻 틀림': r.score.meaning.miss,
  '없는 단어': r.score.extra.length,
  '덩어리 나뉨': pct(r.score.chunkSplit, r.score.found),
  '덩어리 정답과 같음': pct(r.score.chunkSame, r.score.found),
  '추출 시간': sec(r.extractUsage.ms),
  '추출 비용': r.priced ? '$' + r.extractCost.toFixed(3) : '?',
  '전체 비용': r.priced ? '$' + r.cost.toFixed(3) : '?',
}));
console.log('');
console.table(rows);

/* ── 상세 md ─────────────────────────────────────────────────── */

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = [];
out.push('# 모델 비교 ' + stamp);
out.push('');
out.push('사진 ' + photos.length + '장 (' + photos.map((p) => p.name).join(', ') + '), 정답 단어 ' + truth.length + '개, effort ' + EFFORT);
out.push('');
out.push('| ' + Object.keys(rows[0]).join(' | ') + ' |');
out.push('|' + Object.keys(rows[0]).map(() => '---').join('|') + '|');
for (const row of rows) out.push('| ' + Object.values(row).join(' | ') + ' |');
out.push('');
for (const r of results) {
  out.push('## ' + r.model);
  out.push('');
  out.push('토큰 입력 ' + r.usage.input + ' / 출력 ' + r.usage.output + ', 호출 ' + r.usage.calls + '회, ' + sec(r.usage.ms));
  out.push('');
  out.push('### 사진별');
  for (const p of r.perPhoto) out.push('- ' + p.name + ': ' + p.status + ', 단어 ' + p.words + '개, 호출 ' + p.calls + '회, ' + sec(p.ms));
  out.push('');
  if (r.score.missing.length) out.push('**못 찾은 단어**: ' + r.score.missing.join(', '));
  if (r.score.extra.length) out.push('**정답에 없는 단어**: ' + r.score.extra.join(', '));
  if (r.score.meaning.wrong.length) {
    out.push('');
    out.push('**뜻이 다른 것**');
    for (const w of r.score.meaning.wrong) out.push('- ' + w);
  }
  out.push('');
  out.push('### 추출 결과');
  out.push('| 단어 | 뜻 | 덩어리 | 정답 뜻 | 정답 덩어리 |');
  out.push('|---|---|---|---|---|');
  for (const w of r.merged) {
    const t = truthByKey.get(normalize(w.word));
    out.push('| ' + w.word + ' | ' + w.meaning + ' | ' + w.chunks.join('-') + ' | ' + (t ? t.meaning : '—') + ' | ' + (t ? t.chunks.join('-') : '—') + ' |');
  }
  out.push('');
  if (r.phonics) {
    out.push('### 파닉스 규칙 (' + (r.phonics.phonics?.length ?? 0) + '개, ' + (r.phonics.status ?? r.phonics.error) + ')');
    for (const p of r.phonics.phonics ?? []) out.push('- **' + p.pattern + '** [' + p.letters.join(',') + '] ' + p.sound + ' — ' + p.tip + ' → ' + p.words.join(', '));
    const mn = r.phonics.mnemonics ?? {};
    out.push('');
    out.push('### 연상 한 줄 (' + Object.keys(mn).length + '/' + truth.length + '개)');
    for (const [w, tip] of Object.entries(mn)) out.push('- ' + w + ': ' + tip);
    out.push('');
  }
  if (r.story) {
    out.push('### 이야기 (' + (r.story.status ?? r.story.error) + ', 단어 ' + (r.story.used?.length ?? 0) + '개)');
    out.push('');
    out.push(r.story.story || '(없음)');
    out.push('');
  }
}
const outPath = path.join(DIR, 'compare-' + stamp + '.md');
fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
console.log('\n상세 결과: ' + path.relative(ROOT, outPath));
