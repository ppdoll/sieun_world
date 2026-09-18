import test from 'node:test';
import assert from 'node:assert/strict';
import { makePassageSet, passageSetTitle, verifiedCount, MAX_PASSAGE_SETS } from './passagesets.mjs';
import { addWordSet, findWordSet, markStudied, sortByActivity } from './wordsets.mjs';

const P = (at, over = {}) =>
  makePassageSet({ title: 'The Mantis Shrimp', passage: 'One of the most interesting creatures is the shrimp.', sentences: ['a.'], questions: [], ...over }, at, 0.5);

test('makePassageSet: id 는 p 로 시작하고 배열이 아니면 빈 배열로 채운다', () => {
  const s = makePassageSet({ title: null, passage: null, sentences: null, questions: null }, 1000, 0.5);
  assert.match(s.id, /^p1000-/);
  assert.equal(s.title, '');
  assert.deepEqual(s.sentences, []);
  assert.deepEqual(s.questions, []);
});

test('passageSetTitle: 제목이 있으면 날짜와 함께, 없으면 지문 첫머리', () => {
  const at = new Date(2026, 8, 18, 10).getTime();
  assert.equal(passageSetTitle(P(at)), '9월 18일 · The Mantis Shrimp');
  assert.equal(passageSetTitle(P(at, { title: '' })), '9월 18일 · One of the most interesting…');
  assert.equal(passageSetTitle(P(at, { title: '', passage: '' })), '9월 18일');
});

test('verifiedCount: 근거가 검증된 문제만 센다', () => {
  const set = P(1000, { questions: [{ verified: true }, { verified: false }, { verified: true }] });
  assert.equal(verifiedCount(set), 2);
  assert.equal(verifiedCount(null), 0);
});

test('지문 목록도 단어장과 같은 함수로 다룰 수 있다 (id/at 모양이 같다)', () => {
  let list = [];
  for (let i = 1; i <= MAX_PASSAGE_SETS + 1; i++) list = addWordSet(list, P(i * 1000), MAX_PASSAGE_SETS);
  assert.equal(list.length, MAX_PASSAGE_SETS);
  const oldest = list[list.length - 1];
  const studied = markStudied(list, oldest.id, 999999);
  assert.equal(sortByActivity(studied)[0].id, oldest.id, '공부한 지문이 맨 앞으로 온다');
  assert.equal(findWordSet(studied, oldest.id).lastStudiedAt, 999999);
});
