import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPassage,
  splitSentences,
  normalizeForMatch,
  findSentence,
  sanitizeQuestions,
  parsePassageResponse,
  parseQuestionsResponse,
  mergeQuestions,
  flagQuestions,
  passagePrompt,
  questionsPrompt,
  PASSAGE_SCHEMA,
  QUESTION_TYPES,
  MIN_EVIDENCE_CHARS,
} from './passage-logic.mjs';

// 실제 시험지 지문 (Reading Success EP3A UNIT 02)
const PASSAGE =
  'One of the most interesting creatures is the mantis shrimp. ' +
  'They are 15 to 30cm long and live around coral reefs in warm water. ' +
  'They are brightly colored and known for their amazing color vision and strength. ' +
  'Being able to see colors help animals find food and a mate. ' +
  'Humans can see only three groups of colors, red, blue, and green.';
const SENTENCES = splitSentences(PASSAGE);

const Q = (over = {}) => ({
  type: 'detail',
  question: 'What helps animals find food?',
  options: ['being able to see colors', 'the number of groups', 'strength', 'thickness of eyeball'],
  answer: 0,
  evidence: 'Being able to see colors help animals find food and a mate.',
  ...over,
});

const msg = (obj, stop_reason = 'end_turn') => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  stop_reason,
});

/* ── 지문 ─────────────────────────────────────────────────────── */

test('cleanPassage: 줄바꿈은 문단 구분만 남기고 한 줄로 잇는다', () => {
  const raw = 'One of the most\ninteresting creatures\nis the shrimp.\n\n\nThey are   long.\n';
  assert.equal(cleanPassage(raw), 'One of the most interesting creatures is the shrimp.\n\nThey are long.');
  assert.equal(cleanPassage(null), '');
});

test('splitSentences: 마침표 뒤에서 끊고 문장 수와 내용이 맞는다', () => {
  assert.equal(SENTENCES.length, 5);
  assert.equal(SENTENCES[0], 'One of the most interesting creatures is the mantis shrimp.');
  assert.equal(SENTENCES[4], 'Humans can see only three groups of colors, red, blue, and green.');
});

test('splitSentences: 소수점은 끊지 않고 줄임말도 이어 붙인다', () => {
  assert.deepEqual(splitSentences('It is 3.5 meters long. That is big.'), ['It is 3.5 meters long.', 'That is big.']);
  assert.deepEqual(splitSentences('Mr. Kim came. He left.'), ['Mr. Kim came.', 'He left.']);
  assert.deepEqual(splitSentences('물음표도 끊긴다. Really? Yes!'), ['물음표도 끊긴다.', 'Really?', 'Yes!']);
  assert.deepEqual(splitSentences(''), []);
});

test('splitSentences: 마침표 없이 끝나도 마지막 조각을 버리지 않는다', () => {
  assert.deepEqual(splitSentences('No period here'), ['No period here']);
});

/* ── 근거 문장 찾기 ────────────────────────────────────────────── */

test('normalizeForMatch: 대소문자·따옴표·공백·앞뒤 부호를 맞춘다', () => {
  assert.equal(normalizeForMatch('  “They  are LONG.”  '), 'they are long');
  assert.equal(normalizeForMatch(null), '');
});

test('findSentence: 문장을 그대로 인용하면 그 자리를 찾는다', () => {
  assert.equal(findSentence(SENTENCES, 'Being able to see colors help animals find food and a mate.'), 3);
  assert.equal(findSentence(SENTENCES, '  being able to see colors help animals find food and a mate  '), 3);
});

test('findSentence: 문장의 일부만 인용해도 찾는다', () => {
  assert.equal(findSentence(SENTENCES, 'live around coral reefs in warm water'), 1);
});

test('findSentence: 지문에 없는 문장과 너무 짧은 인용은 못 찾은 것으로 본다', () => {
  assert.equal(findSentence(SENTENCES, 'Mantis shrimp can fly to the moon at night.'), -1);
  assert.equal(findSentence(SENTENCES, 'colors'), -1); // 우연히 맞을 수 있는 짧은 인용
  assert.ok('colors'.length < MIN_EVIDENCE_CHARS);
  assert.equal(findSentence([], 'Being able to see colors help animals'), -1);
});

/* ── 문제 검증 ─────────────────────────────────────────────────── */

test('sanitizeQuestions: 정상 문제는 근거 문장과 자리를 붙여 돌려준다', () => {
  const { questions, dropped } = sanitizeQuestions([Q()], SENTENCES);
  assert.equal(dropped, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].evidenceIndex, 3);
  assert.equal(questions[0].verified, true);
  assert.equal(questions[0].evidence, SENTENCES[3]);
});

test('sanitizeQuestions: 지문에 없는 근거를 댄 문제는 버린다 (지어낸 문제)', () => {
  const { questions, dropped } = sanitizeQuestions([Q({ evidence: 'Mantis shrimp live on the moon and eat rocks.' })], SENTENCES);
  assert.deepEqual(questions, []);
  assert.equal(dropped, 1);
});

test('sanitizeQuestions: 주제·의도는 근거를 못 찾아도 남기되 verified=false', () => {
  const { questions } = sanitizeQuestions(
    [Q({ type: 'main', question: 'What is this passage mainly about?', evidence: 'nothing in the passage at all' })],
    SENTENCES
  );
  assert.equal(questions.length, 1);
  assert.equal(questions[0].verified, false);
  assert.equal(questions[0].evidence, '');
  assert.equal(questions[0].evidenceIndex, -1);
});

test('sanitizeQuestions: 보기가 4개가 아니거나 겹치면 버린다', () => {
  const three = sanitizeQuestions([Q({ options: ['a', 'b', 'c'] })], SENTENCES);
  assert.equal(three.questions.length, 0);
  const dup = sanitizeQuestions([Q({ options: ['colors', 'Colors', 'strength', 'groups'] })], SENTENCES);
  assert.equal(dup.questions.length, 0);
  assert.equal(dup.dropped, 1);
});

test('sanitizeQuestions: 정답 번호가 범위를 벗어나면 버린다', () => {
  assert.equal(sanitizeQuestions([Q({ answer: 4 })], SENTENCES).questions.length, 0);
  assert.equal(sanitizeQuestions([Q({ answer: -1 })], SENTENCES).questions.length, 0);
  assert.equal(sanitizeQuestions([Q({ answer: 1.5 })], SENTENCES).questions.length, 0);
  assert.equal(sanitizeQuestions([Q({ answer: 'first' })], SENTENCES).questions.length, 0);
  assert.equal(sanitizeQuestions([Q({ answer: null })], SENTENCES).questions.length, 0);
});

test('sanitizeQuestions: 숫자를 문자열로 준 정답은 고쳐서 받는다 (뜻이 분명한 실수)', () => {
  const { questions } = sanitizeQuestions([Q({ answer: '2' })], SENTENCES);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].answer, 2);
});

test('sanitizeQuestions: 보기의 a. b. 번호를 떼고 질문이 같으면 하나만 남긴다', () => {
  const { questions } = sanitizeQuestions(
    [Q({ options: ['a. being able to see colors', 'b) the number', 'c. strength', 'd. thickness'] }), Q()],
    SENTENCES
  );
  assert.equal(questions.length, 1);
  assert.equal(questions[0].options[0], 'being able to see colors');
  assert.equal(questions[0].options[1], 'the number');
});

test('sanitizeQuestions: 모르는 유형은 세부로 바꾸고, 배열이 아니면 빈 결과', () => {
  assert.equal(sanitizeQuestions([Q({ type: 'weird' })], SENTENCES).questions[0].type, 'detail');
  assert.deepEqual(sanitizeQuestions(null, SENTENCES).questions, []);
});

/* ── 응답 해석 ─────────────────────────────────────────────────── */

test('parsePassageResponse: 지문과 문장, 문제를 함께 돌려준다', () => {
  const r = parsePassageResponse(msg({ title: 'The Mantis Shrimp', passage: PASSAGE, questions: [Q()] }));
  assert.equal(r.status, 'ok');
  assert.equal(r.title, 'The Mantis Shrimp');
  assert.equal(r.sentences.length, 5);
  assert.equal(r.questions.length, 1);
});

test('parsePassageResponse: 지문이 비면 empty, 잘리면 truncated, 거절·깨짐도 구분한다', () => {
  assert.equal(parsePassageResponse(msg({ title: '', passage: '   ', questions: [] })).status, 'empty');
  assert.equal(parsePassageResponse(msg({ passage: PASSAGE, questions: [] }, 'max_tokens')).status, 'truncated');
  assert.equal(parsePassageResponse(msg('{"passage": "잘린', 'max_tokens')).status, 'truncated');
  assert.equal(parsePassageResponse({ content: [], stop_reason: 'refusal' }).status, 'refused');
  assert.equal(parsePassageResponse(msg('사진이 흐려요')).status, 'unparsable');
  assert.equal(parsePassageResponse(null).status, 'unparsable');
});

test('parsePassageResponse: 마크다운 펜스가 붙어도 복구한다', () => {
  const text = '```json\n' + JSON.stringify({ title: 'T', passage: PASSAGE, questions: [] }) + '\n```';
  assert.equal(parsePassageResponse(msg(text)).status, 'ok');
});

test('parseQuestionsResponse: 실패해도 항상 배열', () => {
  assert.deepEqual(parseQuestionsResponse(msg('nope'), SENTENCES).questions, []);
  assert.deepEqual(parseQuestionsResponse(null, SENTENCES).questions, []);
  const ok = parseQuestionsResponse(msg({ questions: [Q()] }), SENTENCES);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.questions.length, 1);
});

test('mergeQuestions: 같은 질문은 하나만 남긴다', () => {
  const a = sanitizeQuestions([Q()], SENTENCES).questions;
  const b = sanitizeQuestions([Q({ answer: 1 }), Q({ question: 'How long are they?' })], SENTENCES).questions;
  const merged = mergeQuestions(a, b);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].answer, 0, '먼저 온 것을 남긴다');
});

test('flagQuestions: 검증 못 한 문제와 너무 긴 보기를 표시한다', () => {
  const { questions } = sanitizeQuestions(
    [
      Q({ type: 'main', question: 'What is this passage mainly about?', evidence: 'x' }),
      Q({ question: 'Where do they live?', options: ['x'.repeat(80), 'b', 'c', 'd'] }),
      Q({ question: 'How long are they?' }),
    ],
    SENTENCES
  );
  const flags = flagQuestions(questions);
  assert.equal(questions.length, 3);
  assert.deepEqual(flags[0], ['unverified']);
  assert.deepEqual(flags[1], ['long-option']);
  assert.deepEqual(flags[2], []);
  assert.deepEqual(flagQuestions(null), []);
});

/* ── 프롬프트·스키마 ───────────────────────────────────────────── */

test('passagePrompt: 손글씨를 무시하라고 분명히 적는다', () => {
  const p = passagePrompt();
  assert.match(p, /연필로 쓴 글씨/);
  assert.match(p, /evidence/);
  assert.match(p, /지어내지 말 것/);
});

test('questionsPrompt: 지문과 유형별 개수를 넣고, 겹치지 말라고 알린다', () => {
  const p = questionsPrompt(PASSAGE, ['What helps animals find food?']);
  assert.match(p, /mantis shrimp/);
  assert.match(p, /main 2개/);
  assert.match(p, /What helps animals find food\?/);
  assert.doesNotMatch(questionsPrompt(PASSAGE), /이미 있는 문제/);
});

test('스키마: 여섯 유형과 필수 항목이 들어 있다', () => {
  const item = PASSAGE_SCHEMA.properties.questions.items;
  assert.deepEqual(item.required, ['type', 'question', 'options', 'answer', 'evidence']);
  assert.deepEqual(item.properties.type.enum, Object.keys(QUESTION_TYPES));
  assert.equal(item.properties.answer.type, 'integer');
  assert.equal(PASSAGE_SCHEMA.additionalProperties, false);
});

/* ── 지문 안의 아는 단어 ───────────────────────────────────────── */

test('buildWordIndex: 여러 단어장을 합치고 뜻이 없는 단어는 뺀다', async () => {
  const { buildWordIndex } = await import('./passage-logic.mjs');
  const map = buildWordIndex([
    { words: [{ word: 'Creature', meaning: '생명체' }, { word: 'empty', meaning: '' }] },
    { words: [{ word: 'creature', meaning: '나중 것' }, { word: 'coral reef', meaning: '산호초' }] },
    null,
  ]);
  assert.equal(map.get('creature'), '생명체', '먼저 나온 뜻을 남긴다');
  assert.equal(map.get('coral reef'), '산호초');
  assert.equal(map.has('empty'), false);
  assert.equal(buildWordIndex(null).size, 0);
});

test('splitSentenceByWords: 아는 단어에 뜻을 달고 나머지 글자는 그대로 둔다', async () => {
  const { buildWordIndex, splitSentenceByWords } = await import('./passage-logic.mjs');
  const map = buildWordIndex([{ words: [{ word: 'creature', meaning: '생명체' }, { word: 'coral reef', meaning: '산호초' }] }]);
  const parts = splitSentenceByWords('The creature lives near a Coral Reef today.', map);
  assert.equal(parts.map((p) => p.text).join(''), 'The creature lives near a Coral Reef today.');
  const marked = parts.filter((p) => p.word);
  assert.deepEqual(marked.map((p) => p.text), ['creature', 'Coral Reef']);
  assert.equal(marked[1].meaning, '산호초');
});

test('splitSentenceByWords: 단어 안에 우연히 들어간 글자는 잡지 않는다', async () => {
  const { buildWordIndex, splitSentenceByWords } = await import('./passage-logic.mjs');
  const map = buildWordIndex([{ words: [{ word: 'mate', meaning: '짝' }, { word: 'in', meaning: '안에' }] }]);
  assert.equal(splitSentenceByWords('The material is interesting.', map).filter((p) => p.word).length, 0);
  assert.deepEqual(splitSentenceByWords('', map), []);
  assert.deepEqual(splitSentenceByWords('그냥 글', new Map()), [{ text: '그냥 글' }]);
});

test('wordForms: 흔한 어미를 함께 만든다', async () => {
  const { wordForms } = await import('./passage-logic.mjs');
  assert.ok(wordForms('reef').includes('reefs'));
  assert.ok(wordForms('creature').includes('creatures'));
  assert.ok(wordForms('recognize').includes('recognized'));
  assert.ok(wordForms('recognize').includes('recognizing'));
  assert.ok(wordForms('study').includes('studies'));
  assert.deepEqual(wordForms(''), []);
});

test('splitSentenceByWords: 지문의 변화형도 원형 단어로 잡아 뜻을 보여준다', async () => {
  const { buildWordIndex, splitSentenceByWords } = await import('./passage-logic.mjs');
  const map = buildWordIndex([
    { words: [{ word: 'creature', meaning: '생명체' }, { word: 'coral reef', meaning: '산호초' }, { word: 'recognize', meaning: '알아보다' }] },
  ]);
  const parts = splitSentenceByWords('These creatures live around coral reefs and recognized us.', map);
  const marked = parts.filter((p) => p.word);
  assert.deepEqual(marked.map((p) => p.text), ['creatures', 'coral reefs', 'recognized']);
  assert.deepEqual(marked.map((p) => p.word), ['creature', 'coral reef', 'recognize']);
  assert.equal(marked[1].meaning, '산호초');
  assert.equal(parts.map((p) => p.text).join(''), 'These creatures live around coral reefs and recognized us.');
});

/* ── 문장 번역 ─────────────────────────────────────────────────── */

test('sanitizeTranslations: 영어 문장을 대조해 제자리에 놓는다', async () => {
  const { sanitizeTranslations } = await import('./passage-logic.mjs');
  const out = sanitizeTranslations(
    [
      { en: SENTENCES[1], ko: '그들은 15~30cm 이고 따뜻한 물의 산호초 주변에 산다.' },
      { en: SENTENCES[0], ko: '  가장  흥미로운 생물 중 하나는 갯가재다. ' },
    ],
    SENTENCES
  );
  assert.equal(out.length, SENTENCES.length);
  assert.equal(out[0], '가장 흥미로운 생물 중 하나는 갯가재다.');
  assert.match(out[1], /산호초/);
  assert.equal(out[2], '', '안 온 자리는 빈 문자열');
});

test('sanitizeTranslations: 지문에 없는 문장의 번역은 버린다 (엉뚱한 자리 방지)', async () => {
  const { sanitizeTranslations } = await import('./passage-logic.mjs');
  const out = sanitizeTranslations(
    [
      { en: 'Mantis shrimp can fly to the moon at night.', ko: '갯가재는 달에 날아간다.' },
      { en: SENTENCES[0], ko: '' },
    ],
    SENTENCES
  );
  assert.deepEqual(out, SENTENCES.map(() => ''));
  assert.deepEqual(sanitizeTranslations(null, SENTENCES).length, SENTENCES.length);
  assert.deepEqual(sanitizeTranslations([], null), []);
});

test('sanitizeTranslations: 같은 문장에 두 번 오면 먼저 온 것만 쓴다', async () => {
  const { sanitizeTranslations } = await import('./passage-logic.mjs');
  const out = sanitizeTranslations(
    [
      { en: SENTENCES[0], ko: '첫 번째 번역' },
      { en: SENTENCES[0], ko: '두 번째 번역' },
    ],
    SENTENCES
  );
  assert.equal(out[0], '첫 번째 번역');
});

test('parseTranslateResponse: 실패해도 문장 수만큼의 빈 배열을 준다', async () => {
  const { parseTranslateResponse } = await import('./passage-logic.mjs');
  assert.deepEqual(parseTranslateResponse(null, SENTENCES).translations.length, SENTENCES.length);
  assert.equal(parseTranslateResponse(msg('번역 못 해요'), SENTENCES).status, 'unparsable');
  assert.equal(parseTranslateResponse({ content: [], stop_reason: 'refusal' }, SENTENCES).status, 'refused');
  const ok = parseTranslateResponse(msg({ translations: [{ en: SENTENCES[0], ko: '첫 문장' }] }), SENTENCES);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.translations[0], '첫 문장');
});

test('missingTranslations: 빠진 자리 수를 센다', async () => {
  const { missingTranslations } = await import('./passage-logic.mjs');
  assert.equal(missingTranslations(['가', '', '다', '', ''], SENTENCES), 3);
  assert.equal(missingTranslations([], SENTENCES), 5);
  assert.equal(missingTranslations(null, null), 0);
});

test('translatePrompt: 문장에 번호를 붙이고 글자 그대로 옮기라고 알린다', async () => {
  const { translatePrompt } = await import('./passage-logic.mjs');
  const p = translatePrompt(SENTENCES);
  assert.match(p, /1\. One of the most/);
  assert.match(p, /글자 그대로/);
  assert.match(p, /초등 4학년/);
});

test('findSentence: 통째로 같으면 짧아도 찾는다 (짧은 질문에 번역을 붙이려고)', () => {
  assert.equal(findSentence(['How fast?', 'What is it?'], 'How fast?'), 0);
  assert.equal(findSentence(['How fast?', 'What is it?'], 'how fast'), 0);
  assert.equal(findSentence(SENTENCES, 'colors'), -1, '일부만 인용한 짧은 글은 여전히 안 받는다');
});

test('toTranslationMap: 원문을 열쇠로 번역을 붙이고 빈 자리는 넣지 않는다', async () => {
  const { toTranslationMap } = await import('./passage-logic.mjs');
  const map = toTranslationMap(['A?', 'B?', 'C?'], ['가', '', '다']);
  assert.deepEqual(map, { 'A?': '가', 'C?': '다' });
  assert.deepEqual(toTranslationMap(null, null), {});
});
