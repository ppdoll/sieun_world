import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  isCorrect,
  commonPrefixLen,
  hintMask,
  makeRng,
  shuffle,
  pickDistractors,
  buildQuiz,
  gradeAnswer,
  summarize,
  collectWrong,
  extractJson,
  sanitizeWords,
} from './wordlab-logic.mjs';

const WORDS = [
  { word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] },
  { word: 'strength', meaning: '힘, 기운', chunks: ['strength'] },
  { word: 'coral reef', meaning: '산호초', chunks: ['co', 'ral', 'reef'] },
  { word: 'vision', meaning: '시력, 눈', chunks: ['vi', 'sion'] },
  { word: 'insert', meaning: '넣다, 삽입하다', chunks: ['in', 'sert'] },
  { word: 'amazing', meaning: '놀라운', chunks: ['a', 'ma', 'zing'] },
];

test('normalize: 대소문자·공백·문장부호를 정리한다', () => {
  assert.equal(normalize('  Make   Up! '), 'make up');
  assert.equal(normalize('Coral-Reef'), 'coralreef');
  assert.equal(normalize(null), '');
});

test('isCorrect: 대소문자와 앞뒤 공백은 무시한다', () => {
  assert.equal(isCorrect('Wound', 'wound'), true);
  assert.equal(isCorrect('  make up  ', 'make up'), true);
  assert.equal(isCorrect('makeup', 'make up'), false);
  assert.equal(isCorrect('scissers', 'scissors'), false);
});

test('isCorrect: 빈 정답은 항상 오답 처리', () => {
  assert.equal(isCorrect('', ''), false);
  assert.equal(isCorrect('anything', ''), false);
});

test('commonPrefixLen: 앞에서 맞은 글자 수를 센다', () => {
  assert.equal(commonPrefixLen('scissers', 'scissors'), 5); // sciss
  assert.equal(commonPrefixLen('bullth', 'bullet'), 4); // bull
  assert.equal(commonPrefixLen('xyz', 'bullet'), 0);
  assert.equal(commonPrefixLen('bullet', 'bullet'), 6);
});

test('hintMask: 첫 글자·끝 글자는 보이고 나머지는 가린다', () => {
  assert.equal(hintMask('coral'), 'c _ _ a l');
  assert.equal(hintMask('material'), 'm _ _ e _ _ a l');
  assert.equal(hintMask(''), '');
});

test('hintMask: 공백은 그대로 유지된다', () => {
  assert.ok(hintMask('coral reef').includes(' '));
  assert.equal(hintMask('coral reef').replace(/[\s_]/g, '').length > 0, true);
});

test('makeRng: 같은 시드는 같은 수열을 만든다', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const c = makeRng(43);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
});

test('shuffle: 원본을 바꾸지 않고 같은 원소를 유지한다', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, makeRng(7));
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
});

test('pickDistractors: 정답 단어는 보기에 섞이지 않는다', () => {
  const d = pickDistractors(WORDS, WORDS[0], 3, makeRng(1));
  assert.equal(d.length, 3);
  assert.equal(d.some((x) => x.word === 'creature'), false);
});

test('buildQuiz: 모든 단어가 한 번씩 출제된다', () => {
  const q = buildQuiz(WORDS, { seed: 5 });
  assert.equal(q.length, WORDS.length);
  assert.deepEqual(
    q.map((x) => x.word).sort(),
    WORDS.map((x) => x.word).sort()
  );
});

test('buildQuiz: 유형이 한쪽으로 쏠리지 않는다', () => {
  const q = buildQuiz(WORDS, { seed: 5 });
  const counts = q.reduce((acc, x) => ({ ...acc, [x.type]: (acc[x.type] || 0) + 1 }), {});
  assert.equal(counts.spell, 2);
  assert.equal(counts.listen, 2);
  assert.equal(counts.meaning, 2);
});

test('buildQuiz: 객관식은 보기 4개에 정답을 포함한다', () => {
  const q = buildQuiz(WORDS, { seed: 5 }).filter((x) => x.type === 'meaning');
  for (const item of q) {
    assert.equal(item.options.length, 4);
    assert.ok(item.options.includes(item.meaning));
    assert.equal(new Set(item.options).size, 4, '보기에 중복이 없어야 한다');
  }
});

test('buildQuiz: 같은 시드면 같은 문제지가 나온다', () => {
  assert.deepEqual(buildQuiz(WORDS, { seed: 9 }), buildQuiz(WORDS, { seed: 9 }));
});

test('buildQuiz: 빈 목록은 빈 배열', () => {
  assert.deepEqual(buildQuiz([], { seed: 1 }), []);
  assert.deepEqual(buildQuiz(null), []);
});

test('buildQuiz: chunks가 없으면 단어 전체를 한 덩어리로 채운다', () => {
  const q = buildQuiz([{ word: 'ship', meaning: '배' }], { seed: 1 });
  assert.deepEqual(q[0].chunks, ['ship']);
});

test('gradeAnswer: 철자 문제는 부분 일치 길이를 함께 돌려준다', () => {
  const q = { type: 'spell', word: 'scissors', meaning: '가위' };
  assert.deepEqual(gradeAnswer(q, 'scissors'), { correct: true, matched: 0 });
  assert.deepEqual(gradeAnswer(q, 'scissers'), { correct: false, matched: 5 });
});

test('gradeAnswer: 객관식은 뜻 문자열을 그대로 비교한다', () => {
  const q = { type: 'meaning', word: 'vision', meaning: '시력, 눈' };
  assert.equal(gradeAnswer(q, '시력, 눈').correct, true);
  assert.equal(gradeAnswer(q, '산호초').correct, false);
});

test('summarize: 점수와 오답 목록을 만든다', () => {
  const results = [
    { word: 'ship', correct: true },
    { word: 'insert', correct: false },
    { word: 'amazing', correct: false },
    { word: 'vision', correct: true },
  ];
  const s = summarize(results);
  assert.equal(s.total, 4);
  assert.equal(s.correct, 2);
  assert.equal(s.percent, 50);
  assert.deepEqual(s.wrong, ['insert', 'amazing']);
});

test('summarize: 빈 결과에서 0으로 나누지 않는다', () => {
  assert.equal(summarize([]).percent, 0);
});

test('collectWrong: 오답 단어 객체만 추려낸다', () => {
  const results = [
    { word: 'creature', correct: false },
    { word: 'strength', correct: true },
    { word: 'vision', correct: false },
  ];
  const wrong = collectWrong(WORDS, results);
  assert.deepEqual(wrong.map((w) => w.word), ['creature', 'vision']);
  assert.ok(wrong[0].chunks, '원본 chunks가 유지되어야 한다');
});

test('extractJson: 순수 JSON을 파싱한다', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('extractJson: 마크다운 펜스를 벗겨낸다', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('extractJson: 앞뒤에 잡문이 붙어도 본문을 건진다', () => {
  assert.deepEqual(extractJson('네, 결과입니다 {"a":1} 이상입니다'), { a: 1 });
});

test('extractJson: 복구 불가능하면 null', () => {
  assert.equal(extractJson('완전히 깨진 응답'), null);
  assert.equal(extractJson('{"a":'), null);
});

test('sanitizeWords: 빈 값과 중복을 걸러낸다', () => {
  const out = sanitizeWords([
    { word: 'ship', meaning: '배', chunks: ['ship'] },
    { word: 'Ship', meaning: '배 중복', chunks: ['ship'] },
    { word: '', meaning: '뜻만 있음' },
    { word: 'shell', meaning: '' },
    { word: 'shell', meaning: '껍데기', chunks: ['shell'] },
  ]);
  assert.deepEqual(out.map((w) => w.word), ['ship', 'shell']);
});

test('sanitizeWords: 철자가 안 맞는 chunks는 통째로 대체한다', () => {
  const out = sanitizeWords([{ word: 'material', meaning: '재료', chunks: ['ma', 'te', 'XX'] }]);
  assert.deepEqual(out[0].chunks, ['material']);
});

test('sanitizeWords: 올바른 chunks는 그대로 둔다', () => {
  const out = sanitizeWords([{ word: 'material', meaning: '재료', chunks: ['ma', 'te', 'ri', 'al'] }]);
  assert.deepEqual(out[0].chunks, ['ma', 'te', 'ri', 'al']);
});

test('sanitizeWords: 두 단어짜리 표제어의 공백을 허용한다', () => {
  const out = sanitizeWords([
    { word: 'coral reef', meaning: '산호초', chunks: ['co', 'ral', 'reef'] },
  ]);
  assert.deepEqual(out[0].chunks, ['co', 'ral', 'reef']);
});

test('sanitizeWords: 배열이 아니면 빈 배열', () => {
  assert.deepEqual(sanitizeWords(null), []);
  assert.deepEqual(sanitizeWords('nope'), []);
});

test('sanitizeWords: keepEmptyMeaning 이면 뜻이 빈 항목을 남기고, 빈 단어는 여전히 버린다', () => {
  const raw = [
    { word: 'insert', meaning: '', chunks: ['in', 'sert'] },
    { word: '', meaning: '뜻만 있음', chunks: [] },
    { word: 'vision', meaning: '시력', chunks: ['vi', 'sion'] },
  ];
  const kept = sanitizeWords(raw, { keepEmptyMeaning: true });
  assert.deepEqual(kept.map((w) => w.word), ['insert', 'vision']);
  assert.equal(kept[0].meaning, '');
  assert.deepEqual(sanitizeWords(raw).map((w) => w.word), ['vision']);
});

test('chunksMatch: 이어붙인 철자가 같으면 true, 공백·대소문자는 무시', async () => {
  const { chunksMatch } = await import('./wordlab-logic.mjs');
  assert.equal(chunksMatch('material', ['ma', 'te', 'ri', 'al']), true);
  assert.equal(chunksMatch('Coral reef', ['co', 'ral', 'reef']), true);
  assert.equal(chunksMatch('creature', ['crea', 'tur']), false);
  assert.equal(chunksMatch('creature', []), false);
  assert.equal(chunksMatch('creature', null), false);
});
