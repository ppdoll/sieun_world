import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normLang,
  cleanDefinition,
  sanitizeKeys,
  sanitizeDefinitionWords,
  detectMeaningLang,
  MAX_KEYS,
} from './definition-logic.mjs';

const BECAUSE = 'Because introduces a reason for something.';
const MILLION = 'A million is another way to write the number 1,000,000.';

test('normLang: en 만 en, 나머지는 예전 단어장처럼 ko', () => {
  assert.equal(normLang('en'), 'en');
  assert.equal(normLang('ko'), 'ko');
  assert.equal(normLang(undefined), 'ko');
  assert.equal(normLang('EN'), 'ko');
});

test('cleanDefinition: 앞의 품사 표시를 떼고 공백을 줄인다', () => {
  assert.equal(cleanDefinition('conj.  Because introduces a reason for something.'), BECAUSE);
  assert.equal(cleanDefinition('n. A place is a space or area.'), 'A place is a space or area.');
  assert.equal(cleanDefinition('adj. Expensive things cost a lot of money.'), 'Expensive things cost a lot of money.');
  assert.equal(cleanDefinition('A place is a space or area.'), 'A place is a space or area.', '품사가 없으면 그대로');
  assert.equal(cleanDefinition(null), '');
});

test('sanitizeKeys: 풀이에 있는 낱말만 남긴다 (지어낸 핵심 낱말로 채점하지 않는다)', () => {
  assert.deepEqual(sanitizeKeys(['reason', 'cause', 'explain'], BECAUSE, 'because'), ['reason']);
});

test('sanitizeKeys: 표제어와 불용어는 뺀다', () => {
  assert.deepEqual(sanitizeKeys(['because', 'reason', 'something', 'a'], BECAUSE, 'because'), ['reason']);
});

test('sanitizeKeys: 변화형과 숫자를 맞추고 같은 낱말은 하나만', () => {
  assert.deepEqual(
    sanitizeKeys(['plant', 'Plants', 'grow'], 'A garden is an area where people grow plants.', 'garden'),
    ['plant', 'grow']
  );
  assert.deepEqual(sanitizeKeys(['number', '1,000,000'], MILLION, 'million'), ['number', '1,000,000']);
});

test('sanitizeKeys: 하나도 안 남으면 풀이에서 자동으로 고른다', () => {
  assert.deepEqual(sanitizeKeys(['nonsense'], 'A mountain is a very high hill.', 'mountain'), ['high', 'hill']);
  assert.deepEqual(sanitizeKeys(null, 'A place is a space or area.', 'place'), ['space', 'area']);
});

test('sanitizeKeys: 최대 개수까지만', () => {
  const def = 'Alpha bravo charlie delta echo foxtrot golf.';
  assert.equal(sanitizeKeys(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'], def, 'x').length, MAX_KEYS);
});

test('sanitizeDefinitionWords: 풀이를 정리하고 핵심 낱말을 검증해 붙인다', () => {
  const [w] = sanitizeDefinitionWords([
    { word: 'because', meaning: 'conj. ' + BECAUSE, chunks: ['be', 'cause'], keys: ['reason', 'made-up'], example: 'We study.' },
  ]);
  assert.equal(w.meaning, BECAUSE);
  assert.deepEqual(w.keys, ['reason']);
  assert.equal(w.example, 'We study.', '다른 칸은 그대로');
  assert.deepEqual(sanitizeDefinitionWords(null), []);
});

test('detectMeaningLang: 뜻의 절반 넘게 한글이면 ko, 아니면 en', () => {
  assert.equal(detectMeaningLang([{ meaning: '생명체' }, { meaning: '산호초' }, { meaning: 'x' }]), 'ko');
  assert.equal(detectMeaningLang([{ meaning: BECAUSE }, { meaning: MILLION }, { meaning: '산호초' }]), 'en');
  assert.equal(detectMeaningLang([]), 'ko');
});

/* ── 핵심 낱말 보기 ───────────────────────────────────────────── */

// 실제 교재 WORD LIST 페이지
const PAGE = [
  { word: 'because', meaning: 'Because introduces a reason for something.', keys: ['introduces', 'reason'] },
  { word: 'flower', meaning: 'A flower is the colored part of a plant.', keys: ['colored', 'part', 'plant'] },
  { word: 'garden', meaning: 'A garden is an area where people grow plants.', keys: ['area', 'grow', 'plants'] },
  { word: 'place', meaning: 'A place is a space or area.', keys: ['space', 'area'] },
  { word: 'mountain', meaning: 'A mountain is a very high hill.', keys: ['high', 'hill'] },
];

test('keysOf: 단어장의 핵심 낱말을 쓰고, 없으면 풀이에서 고른다', async () => {
  const { keysOf } = await import('./definition-logic.mjs');
  assert.deepEqual(keysOf(PAGE[0]), ['introduces', 'reason']);
  assert.deepEqual(keysOf({ word: 'place', meaning: 'A place is a space or area.' }), ['space', 'area']);
  assert.deepEqual(keysOf(null), []);
});

test('keyGroups: 여러 풀이에 함께 나오는 낱말을 많이 나온 순으로 모은다', async () => {
  const { keyGroups } = await import('./definition-logic.mjs');
  const groups = keyGroups(PAGE);
  const area = groups.find((g) => g.key === 'area');
  assert.deepEqual(area.words, ['garden', 'place']);
  const plant = groups.find((g) => /plant/.test(g.key));
  assert.deepEqual(plant.words, ['flower', 'garden'], '변화형(plant/plants)도 한 묶음');
  assert.ok(groups.every((g) => g.words.length >= 2), '한 번만 나온 낱말은 묶지 않는다');
  assert.ok(!groups.some((g) => g.key === 'reason'));
});

test('keyGroups: 한 단어 안에서 같은 낱말이 두 번 나와도 한 번만 센다', async () => {
  const { keyGroups } = await import('./definition-logic.mjs');
  const dup = [{ word: 'x', meaning: 'A plant grows plants.', keys: ['plant', 'plants', 'grows'] }];
  assert.deepEqual(keyGroups(dup), []);
});

test('keyGroups: 최대 개수까지만, 빈 입력은 빈 배열', async () => {
  const { keyGroups } = await import('./definition-logic.mjs');
  assert.ok(keyGroups(PAGE, { min: 1, max: 3 }).length <= 3);
  assert.deepEqual(keyGroups(null), []);
  assert.deepEqual(keyGroups([{ word: 'a' }]), []);
});
