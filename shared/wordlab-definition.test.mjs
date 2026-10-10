// 영어 풀이(영영) 단어장 채점 — 실제 교재 WORD LIST 페이지의 단어로 확인한다
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeText,
  stemWord,
  contentWords,
  autoKeys,
  gradeDefinition,
  blankWord,
  maskDefinition,
  buildQuiz,
  gradeAnswer,
  sanitizeWords,
  wordForms,
} from './wordlab-logic.mjs';

const DEF = {
  because: 'Because introduces a reason for something.',
  east: 'East is the direction the sun rises from.',
  expensive: 'Expensive things cost a lot of money.',
  flower: 'A flower is the colored part of a plant.',
  garden: 'A garden is an area where people grow plants.',
  many: 'Many shows that there is a large number of something.',
  million: 'A million is another way to write the number 1,000,000.',
  mountain: 'A mountain is a very high hill.',
  place: 'A place is a space or area.',
};

/* ── 낱말 나누기·어간 ─────────────────────────────────────────── */

test('tokenizeText: 소문자 낱말로 나누고 1,000,000 은 한 낱말로 붙인다', () => {
  assert.deepEqual(tokenizeText('A million is the number 1,000,000.'), ['a', 'million', 'is', 'the', 'number', '1000000']);
  assert.deepEqual(tokenizeText("It's a sun-rise!"), ['its', 'a', 'sun', 'rise']);
  assert.deepEqual(tokenizeText(null), []);
});

test('stemWord: 흔한 어미를 같게 본다', () => {
  assert.equal(stemWord('plants'), stemWord('plant'));
  assert.equal(stemWord('rises'), stemWord('rise'));
  assert.equal(stemWord('rising'), stemWord('rise'));
  assert.equal(stemWord('colored'), stemWord('color'));
  assert.equal(stemWord('places'), stemWord('place'));
  assert.equal(stemWord('studies'), 'study');
  assert.equal(stemWord('boxes'), stemWord('box'));
  assert.notEqual(stemWord('hill'), stemWord('high'));
});

/* ── 핵심 낱말 ─────────────────────────────────────────────────── */

test('contentWords: 불용어와 표제어를 빼고 나온 순서대로', () => {
  assert.deepEqual(contentWords(DEF.because, 'because'), ['introduces', 'reason']);
  assert.deepEqual(contentWords(DEF.mountain, 'mountain'), ['high', 'hill']);
  assert.deepEqual(contentWords(DEF.place, 'place'), ['space', 'area']);
  assert.ok(contentWords(DEF.million, 'million').includes('1000000'));
  assert.ok(!contentWords(DEF.many, 'many').includes('many'), '표제어는 핵심 낱말이 아니다');
});

test('autoKeys: 최대 개수까지만', () => {
  assert.equal(autoKeys(DEF.million, 'million', 2).length, 2);
  assert.deepEqual(autoKeys('', 'x'), []);
});

/* ── 풀이 쓰기 채점 ────────────────────────────────────────────── */

test('gradeDefinition: 핵심 낱말이 다 있으면 맞다', () => {
  assert.equal(gradeDefinition('a very high hill', ['high', 'hill']).correct, true);
  assert.equal(gradeDefinition('It is a HIGH Hill!', ['high', 'hill']).correct, true);
});

test('gradeDefinition: 빠진 핵심 낱말을 알려준다 (부분 정답)', () => {
  const g = gradeDefinition('a high place', ['high', 'hill']);
  assert.equal(g.correct, false);
  assert.deepEqual(g.found, ['high']);
  assert.deepEqual(g.missing, ['hill']);
  assert.equal(g.total, 2);
});

test('gradeDefinition: 변화형은 같은 낱말로 본다', () => {
  assert.equal(gradeDefinition('an area where people grow plant', ['area', 'grow', 'plants']).correct, true);
  assert.equal(gradeDefinition('the direction the sun rise from', ['direction', 'sun', 'rises']).correct, true);
  assert.equal(gradeDefinition('the number 1000000', ['number', '1,000,000']).correct, true);
});

test('gradeDefinition: 핵심 낱말이 없으면 풀이에서 자동으로 고른다', () => {
  const g = gradeDefinition('a space or area', [], DEF.place, 'place');
  assert.equal(g.correct, true);
  assert.deepEqual(g.found, ['space', 'area']);
});

test('gradeDefinition: 빈 답은 틀리다', () => {
  assert.equal(gradeDefinition('', ['high', 'hill']).correct, false);
  assert.equal(gradeDefinition(null, ['reason']).correct, false);
});

/* ── 풀이 속 표제어 가리기 ─────────────────────────────────────── */

test('blankWord: 풀이 속 표제어를 가린다 (풀이를 보고 단어를 쓰는 문제)', () => {
  assert.equal(blankWord(DEF.because, 'because'), '___ introduces a reason for something.');
  assert.equal(blankWord(DEF.many, 'many'), '___ shows that there is a large number of something.');
  assert.equal(blankWord(DEF.million, 'million'), 'A ___ is another way to write the number 1,000,000.');
});

test('blankWord: 예문의 변화형도 가리고, 비슷한 다른 단어는 건드리지 않는다', () => {
  assert.equal(blankWord('She gave pink flowers to her grandmother.', 'flower'), 'She gave pink ___ to her grandmother.');
  assert.equal(
    blankWord('My window looks to the east, so I can watch the sunrise every morning.', 'east'),
    'My window looks to the ___, so I can watch the sunrise every morning.'
  );
  assert.equal(
    blankWord('Mount Everest is the highest mountain in the world.', 'mountain'),
    'Mount Everest is the highest ___ in the world.'
  );
  assert.equal(blankWord('', 'east'), '');
});

test('maskDefinition: 핵심 낱말만 마스크 힌트로 바꾼다', () => {
  assert.equal(maskDefinition(DEF.mountain, ['high', 'hill']), 'A mountain is a very h _ _ h h _ _ l.');
  assert.equal(maskDefinition(DEF.because, ['reason']), 'Because introduces a r _ _ s _ n for something.');
  assert.equal(maskDefinition(DEF.place, []), DEF.place);
});

test('wordForms: 채점 모듈에서도 같은 변화형을 만든다', () => {
  assert.ok(wordForms('flower').includes('flowers'));
});

/* ── 문제지와 채점 ─────────────────────────────────────────────── */

const WORDS = Object.entries(DEF).map(([word, meaning]) => ({
  word,
  meaning,
  chunks: [word],
  ...(word === 'mountain' ? { keys: ['high', 'hill'], example: 'Mount Everest is the highest mountain in the world.' } : {}),
}));

test('buildQuiz(en): 풀이→단어 문제는 풀이 속 단어를 가리고, 단어→풀이 문제는 단어를 보여준다', () => {
  const quiz = buildQuiz(WORDS, { seed: 3, types: ['spell', 'define'], lang: 'en' });
  assert.equal(quiz.length, WORDS.length);
  for (const q of quiz) {
    assert.ok(Array.isArray(q.keys) && q.keys.length > 0, q.word + ' 에 핵심 낱말이 있어야 한다');
    if (q.type === 'spell') {
      assert.doesNotMatch(q.prompt.toLowerCase(), new RegExp('\\b' + q.word + '\\b'), '답이 문제에 보이면 안 된다');
      assert.match(q.prompt, /___/);
    } else {
      assert.equal(q.type, 'define');
      assert.equal(q.prompt, q.word);
    }
  }
  const m = quiz.find((q) => q.word === 'mountain');
  assert.deepEqual(m.keys, ['high', 'hill'], '단어장에 있는 핵심 낱말을 그대로 쓴다');
  assert.equal(m.exampleBlank, 'Mount Everest is the highest ___ in the world.');
});

test('buildQuiz(ko): 한글 뜻 단어장은 예전과 같은 모양이다', () => {
  const q = buildQuiz([{ word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] }], { seed: 1, types: ['spell'] })[0];
  assert.equal(q.prompt, undefined);
  assert.equal(q.keys, undefined);
  assert.equal(q.meaning, '생명체');
});

test('gradeAnswer(define): 핵심 낱말로 채점하고 찾은 것과 빠진 것을 돌려준다', () => {
  const q = buildQuiz([WORDS.find((w) => w.word === 'mountain')], { seed: 1, types: ['define'], lang: 'en' })[0];
  assert.equal(gradeAnswer(q, 'a very high hill').correct, true);
  const half = gradeAnswer(q, 'something high');
  assert.equal(half.correct, false);
  assert.deepEqual(half.found, ['high']);
  assert.deepEqual(half.missing, ['hill']);
});

test('gradeAnswer(spell, en): 풀이→단어는 예전처럼 철자로 채점한다', () => {
  const q = buildQuiz([WORDS[0]], { seed: 1, types: ['spell'], lang: 'en' })[0];
  assert.equal(gradeAnswer(q, 'Because').correct, true);
  assert.equal(gradeAnswer(q, 'becuase').correct, false);
  assert.equal(gradeAnswer(q, 'becuase').matched, 3);
});

/* ── 정리 ─────────────────────────────────────────────────────── */

test('sanitizeWords: 예문·핵심 낱말·한국어 뜻을 있을 때만 붙인다', () => {
  const [a, b] = sanitizeWords([
    { word: 'east', meaning: DEF.east, chunks: ['east'], example: '  My window  looks east. ', keys: ['direction', ' ', 'sun'], ko: ' 동쪽 ' },
    { word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] },
  ]);
  assert.equal(a.example, 'My window looks east.');
  assert.deepEqual(a.keys, ['direction', 'sun']);
  assert.equal(a.ko, '동쪽');
  assert.deepEqual(b, { word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] }, '한글 뜻 단어장은 모양이 그대로');
});

test('markKeys: 쓴 낱말과 빠진 낱말에 표시를 달고, 이으면 원래 풀이와 같다', async () => {
  const { markKeys } = await import('./wordlab-logic.mjs');
  const def = 'A garden is an area where people grow plants.';
  const parts = markKeys(def, ['area', 'grow'], ['plants']);
  assert.equal(parts.map((p) => p.text).join(''), def);
  assert.deepEqual(
    parts.filter((p) => p.mark).map((p) => p.text + ':' + p.mark),
    ['area:found', 'grow:found', 'plants:missing']
  );
});

test('markKeys: 숫자와 변화형도 맞추고, 표시할 게 없으면 통째로 한 조각', async () => {
  const { markKeys } = await import('./wordlab-logic.mjs');
  const parts = markKeys('A million is the number 1,000,000.', ['number'], ['1000000']);
  assert.deepEqual(parts.filter((p) => p.mark).map((p) => p.text), ['number', '1,000,000']);
  assert.deepEqual(markKeys('A place is a space.', [], []), [{ text: 'A place is a space.' }]);
  assert.deepEqual(markKeys('', ['x'], []), []);
});
