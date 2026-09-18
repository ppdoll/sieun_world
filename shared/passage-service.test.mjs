import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPassageFromImage, generateQuestions, MIN_QUESTIONS } from './passage-service.mjs';
import { splitSentences } from './passage-logic.mjs';

const IMG = { data: 'AAAA', mediaType: 'image/jpeg' };
const PASSAGE =
  'One of the most interesting creatures is the mantis shrimp. ' +
  'They are 15 to 30cm long and live around coral reefs in warm water. ' +
  'They are brightly colored and known for their amazing color vision and strength. ' +
  'Being able to see colors help animals find food and a mate. ' +
  'Humans can see only three groups of colors, red, blue, and green.';
const SENTENCES = splitSentences(PASSAGE);

const q = (n, over = {}) => ({
  type: 'detail',
  question: 'Question number ' + n + '?',
  options: ['a' + n, 'b' + n, 'c' + n, 'd' + n],
  answer: 0,
  evidence: SENTENCES[n % SENTENCES.length],
  ...over,
});

const reply = (obj, stop_reason = 'end_turn') => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason,
});

function fakeModel(responses) {
  const prompts = [];
  const callModel = async (req) => {
    prompts.push(req.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join(' | '));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { callModel, prompts };
}

/* ── 지문 추출 ─────────────────────────────────────────────────── */

test('extractPassageFromImage: 정상이면 한 번만 호출한다', async () => {
  const { callModel, prompts } = fakeModel([reply({ title: 'The Mantis Shrimp', passage: PASSAGE, questions: [q(1)] })]);
  const r = await extractPassageFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'ok');
  assert.equal(r.calls, 1);
  assert.equal(r.title, 'The Mantis Shrimp');
  assert.equal(r.sentences.length, 5);
  assert.equal(r.questions.length, 1);
  assert.match(prompts[0], /^\[image\] \| 이 페이지의 읽기 지문/);
});

test('extractPassageFromImage: JSON 이 깨지면 한 번만 다시 묻는다', async () => {
  const { callModel } = fakeModel([
    { content: [{ type: 'text', text: '사진이 흐려요' }], stop_reason: 'end_turn' },
    reply({ title: '', passage: PASSAGE, questions: [] }),
  ]);
  const r = await extractPassageFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'ok');
  assert.equal(r.calls, 2);
});

test('extractPassageFromImage: 두 번 다 실패해도 건진 지문이 있으면 살린다', async () => {
  const { callModel } = fakeModel([
    reply({ title: '', passage: PASSAGE, questions: [] }, 'max_tokens'),
    { content: [{ type: 'text', text: '???' }], stop_reason: 'end_turn' },
  ]);
  const r = await extractPassageFromImage({ image: IMG, callModel });
  assert.equal(r.calls, 2);
  assert.equal(r.status, 'truncated');
  assert.ok(r.passage.length > 0, '첫 응답에서 건진 지문을 버리지 않는다');
});

test('extractPassageFromImage: 거절이면 즉시 중단한다', async () => {
  const { callModel } = fakeModel([{ content: [], stop_reason: 'refusal' }]);
  const r = await extractPassageFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'refused');
  assert.equal(r.calls, 1);
});

test('extractPassageFromImage: 모델 오류는 그대로 던진다 (핸들러가 문구로 바꾼다)', async () => {
  const { callModel } = fakeModel([new Error('boom')]);
  await assert.rejects(extractPassageFromImage({ image: IMG, callModel }), /boom/);
});

/* ── 모의 문제 ─────────────────────────────────────────────────── */

test('generateQuestions: 충분히 건지면 한 번만 호출한다', async () => {
  const many = Array.from({ length: MIN_QUESTIONS }, (_, i) => q(i));
  const { callModel, prompts } = fakeModel([reply({ questions: many })]);
  const r = await generateQuestions({ passage: PASSAGE, sentences: SENTENCES, callModel });
  assert.equal(r.calls, 1);
  assert.equal(r.questions.length, MIN_QUESTIONS);
  assert.match(prompts[0], /mantis shrimp/);
});

test('generateQuestions: 검증에서 많이 걸러지면 한 번 더 만들어 채운다', async () => {
  const bad = q(1, { evidence: '지문에 없는 문장입니다 여기에는' });
  const { callModel, prompts } = fakeModel([
    reply({ questions: [q(2), bad] }),
    reply({ questions: [q(3), q(4), q(5)] }),
  ]);
  const r = await generateQuestions({ passage: PASSAGE, sentences: SENTENCES, callModel });
  assert.equal(r.calls, 2);
  assert.deepEqual(r.questions.map((x) => x.question), ['Question number 2?', 'Question number 3?', 'Question number 4?', 'Question number 5?']);
  assert.equal(r.dropped, 1);
  assert.match(prompts[1], /Question number 2\?/, '이미 나온 질문은 빼달라고 알린다');
});

test('generateQuestions: 두 번 해도 못 만들면 빈 배열로 끝난다 (무한 재시도 없음)', async () => {
  const { callModel } = fakeModel([reply({ questions: [] }), reply({ questions: [] })]);
  const r = await generateQuestions({ passage: PASSAGE, sentences: SENTENCES, callModel });
  assert.equal(r.calls, 2);
  assert.deepEqual(r.questions, []);
});

test('generateQuestions: 거절이면 즉시 중단하고, sentences 를 안 줘도 지문에서 뽑는다', async () => {
  let m = fakeModel([{ content: [], stop_reason: 'refusal' }]);
  const refused = await generateQuestions({ passage: PASSAGE, callModel: m.callModel });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.calls, 1);

  m = fakeModel([reply({ questions: Array.from({ length: MIN_QUESTIONS }, (_, i) => q(i)) })]);
  const ok = await generateQuestions({ passage: PASSAGE, callModel: m.callModel });
  assert.equal(ok.questions.length, MIN_QUESTIONS, 'sentences 가 없으면 지문을 직접 나눠 검증한다');
});

/* ── 문장 번역 ─────────────────────────────────────────────────── */

test('translateSentences: 한 번에 다 받으면 호출 한 번', async () => {
  const { translateSentences } = await import('./passage-service.mjs');
  const { callModel, prompts } = fakeModel([
    reply({ translations: SENTENCES.map((en, i) => ({ en, ko: '번역' + i })) }),
  ]);
  const r = await translateSentences({ sentences: SENTENCES, callModel });
  assert.equal(r.calls, 1);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.translations, SENTENCES.map((_, i) => '번역' + i));
  assert.match(prompts[0], /1\. One of the most/);
});

test('translateSentences: 빠진 문장만 다시 묻는다', async () => {
  const { translateSentences } = await import('./passage-service.mjs');
  const { callModel, prompts } = fakeModel([
    reply({ translations: [{ en: SENTENCES[0], ko: '첫째' }, { en: SENTENCES[2], ko: '셋째' }] }),
    reply({ translations: [{ en: SENTENCES[1], ko: '둘째' }, { en: SENTENCES[3], ko: '넷째' }, { en: SENTENCES[4], ko: '다섯째' }] }),
  ]);
  const r = await translateSentences({ sentences: SENTENCES, callModel });
  assert.equal(r.calls, 2);
  assert.deepEqual(r.translations, ['첫째', '둘째', '셋째', '넷째', '다섯째']);
  assert.doesNotMatch(prompts[1], /One of the most/, '이미 받은 문장은 다시 안 보낸다');
  assert.match(prompts[1], /15 to 30cm/);
});

test('translateSentences: 두 번 다 실패해도 문장 수만큼 빈 배열, 거절은 즉시 중단', async () => {
  const { translateSentences } = await import('./passage-service.mjs');
  let m = fakeModel([reply({ translations: [] }), reply({ translations: [] })]);
  const weak = await translateSentences({ sentences: SENTENCES, callModel: m.callModel });
  assert.equal(weak.calls, 2);
  assert.deepEqual(weak.translations, SENTENCES.map(() => ''));

  m = fakeModel([{ content: [], stop_reason: 'refusal' }]);
  const refused = await translateSentences({ sentences: SENTENCES, callModel: m.callModel });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.calls, 1);

  const none = await translateSentences({ sentences: [], callModel: fakeModel([]).callModel });
  assert.equal(none.calls, 0);
});
