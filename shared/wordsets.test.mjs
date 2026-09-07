import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_WORDSETS,
  makeWordSet,
  addWordSet,
  removeWordSet,
  updateWordSet,
  findWordSet,
  wordSetTitle,
  migrateLegacy,
} from './wordsets.mjs';

const W = (word) => ({ word, meaning: '뜻', chunks: [word] });
const setAt = (at, words = [W('creature')]) => makeWordSet(words, [], at, 0.5);

test('makeWordSet: id 는 시각과 난수로 만들고 배열이 아니면 빈 배열로 채운다', () => {
  const s = makeWordSet(null, undefined, 1000, 0.5);
  assert.match(s.id, /^1000-/);
  assert.deepEqual(s.words, []);
  assert.deepEqual(s.phonics, []);
  assert.equal(s.at, 1000);
});

test('addWordSet: 맨 앞에 넣고 최대 개수를 넘으면 오래된 것을 버린다', () => {
  let list = [];
  for (let i = 1; i <= MAX_WORDSETS + 2; i++) list = addWordSet(list, setAt(i * 1000));
  assert.equal(list.length, MAX_WORDSETS);
  assert.equal(list[0].at, (MAX_WORDSETS + 2) * 1000);
  assert.equal(list[list.length - 1].at, 3000);
});

test('addWordSet: 같은 id 가 이미 있으면 내용을 교체한다 (순서는 활동 순 그대로)', () => {
  const a = setAt(1000);
  const b = setAt(2000);
  const list = addWordSet(addWordSet([], a), b);
  const again = addWordSet(list, { ...a, phonics: [{ pattern: 'x' }] });
  assert.equal(again.length, 2);
  assert.equal(again[0].id, b.id);
  assert.equal(again[1].id, a.id);
  assert.equal(again[1].phonics.length, 1);
});

test('removeWordSet / findWordSet / updateWordSet', () => {
  const a = setAt(1000);
  const b = setAt(2000);
  const list = [b, a];
  assert.equal(findWordSet(list, a.id), a);
  assert.equal(findWordSet(list, 'nope'), null);
  assert.deepEqual(removeWordSet(list, a.id), [b]);
  const updated = updateWordSet(list, b.id, { phonics: [{ pattern: '-ture' }] });
  assert.equal(updated[0].phonics.length, 1);
  assert.equal(updated[1], a);
  assert.deepEqual(removeWordSet(null, 'x'), []);
});

test('wordSetTitle: 날짜 · 첫 단어 외 n개', () => {
  const at = new Date(2026, 8, 7, 10).getTime(); // 9월 7일
  assert.equal(wordSetTitle(setAt(at, [W('creature'), W('vision'), W('insert')])), '9월 7일 · creature 외 2개');
  assert.equal(wordSetTitle(setAt(at, [W('creature')])), '9월 7일 · creature');
  assert.equal(wordSetTitle(setAt(at, [])), '9월 7일');
});

test('migrateLegacy: 목록이 비어 있고 예전 저장분이 있으면 첫 항목으로 만든다', () => {
  const legacy = { words: [W('creature')], phonics: [{ pattern: '-ture' }], at: 5000 };
  const list = migrateLegacy([], legacy);
  assert.equal(list.length, 1);
  assert.equal(list[0].at, 5000);
  assert.equal(list[0].phonics.length, 1);
});

test('migrateLegacy: 목록이 이미 있으면 그대로, 예전 것이 비었으면 빈 목록', () => {
  const existing = [setAt(1000)];
  assert.equal(migrateLegacy(existing, { words: [W('x')] }), existing);
  assert.deepEqual(migrateLegacy([], { words: [] }), []);
  assert.deepEqual(migrateLegacy(undefined, null), []);
});

test('mergeWordSets: 같은 id 는 공유 쪽을 믿고 synced 표시, 최근 순, 최대 개수', async () => {
  const { mergeWordSets } = await import('./wordsets.mjs');
  const a = setAt(1000);
  const b = setAt(2000);
  const c = setAt(3000);
  const local = [b, a];
  const remote = [{ ...a, phonics: [{ pattern: '-ture' }] }, c];
  const merged = mergeWordSets(local, remote);
  assert.deepEqual(merged.map((s) => s.at), [3000, 2000, 1000]);
  assert.equal(merged[2].phonics.length, 1);
  assert.equal(merged[2].synced, true);
  assert.equal(merged[0].synced, true);
  assert.equal(merged[1].synced, undefined);
  assert.equal(mergeWordSets(local, remote, 2).length, 2);
  assert.deepEqual(mergeWordSets(null, undefined), []);
});

test('toRemoteWordSet: 필요한 필드만 남기고 이상한 값은 null', async () => {
  const { toRemoteWordSet } = await import('./wordsets.mjs');
  const s = { ...setAt(1000), synced: true, junk: 1, mnemonics: { creature: '크리-처!' }, story: 'creature 이야기' };
  const r = toRemoteWordSet(s);
  assert.deepEqual(Object.keys(r).sort(), ['at', 'id', 'mnemonics', 'phonics', 'story', 'words']);
  assert.deepEqual(r.mnemonics, { creature: '크리-처!' });
  assert.equal(r.story, 'creature 이야기');
  assert.deepEqual(toRemoteWordSet(setAt(1000)).mnemonics, {});
  assert.equal(toRemoteWordSet({ ...setAt(1000), mnemonics: ['bad'] }).mnemonics instanceof Array, false);
  assert.equal(toRemoteWordSet({ id: 'x', words: [] }), null);
  assert.equal(toRemoteWordSet({ words: [W('a')] }), null);
  assert.equal(toRemoteWordSet(null), null);
});

test('markStudied / activityAt / sortByActivity: 공부한 오래된 단어장이 앞으로 온다', async () => {
  const { markStudied, activityAt, sortByActivity } = await import('./wordsets.mjs');
  const old = setAt(1000);
  const recent = setAt(5000);
  const list = markStudied([recent, old], old.id, 9000);
  assert.equal(activityAt(list[1]), 9000);
  assert.equal(activityAt(recent), 5000);
  assert.deepEqual(sortByActivity(list).map((s) => s.at), [1000, 5000]);
});

test('addWordSet: 잘라낼 때 활동이 오래된 것부터 버린다 (공부한 옛 단어장은 남는다)', async () => {
  const { markStudied } = await import('./wordsets.mjs');
  let list = [];
  for (let i = 1; i <= 3; i++) list = addWordSet(list, setAt(i * 1000), 3);
  list = markStudied(list, list.find((s) => s.at === 1000).id, 99000); // 가장 오래된 것을 방금 공부
  list = addWordSet(list, setAt(4000), 3);
  assert.deepEqual(list.map((s) => s.at).sort(), [1000, 3000, 4000]); // 2000 이 밀려남
});

test('mergeWordSets: 공유 쪽 내용을 받되 이 기기의 공부 기록은 남긴다', async () => {
  const { mergeWordSets } = await import('./wordsets.mjs');
  const a = { ...setAt(1000), lastStudiedAt: 8000 };
  const merged = mergeWordSets([a], [{ ...setAt(1000), phonics: [{ pattern: '-ture' }] }]);
  assert.equal(merged[0].lastStudiedAt, 8000);
  assert.equal(merged[0].phonics.length, 1);
  assert.equal(merged[0].synced, true);
});

test('combineWordSets: 단어는 중복 없이, 규칙은 pattern 기준으로 하나만, 연상은 합친다', async () => {
  const { combineWordSets } = await import('./wordsets.mjs');
  const s1 = { ...setAt(1000, [W('creature'), W('vision')]), phonics: [{ pattern: '-ture' }, { pattern: '-sion' }], mnemonics: { creature: '크리처' } };
  const s2 = { ...setAt(2000, [W('Vision'), W('insert')]), phonics: [{ pattern: '-TURE' }, { pattern: 'in-' }], mnemonics: { creature: '다른', insert: '인서트' } };
  const c = combineWordSets([s1, s2, null]);
  assert.deepEqual(c.words.map((w) => w.word), ['creature', 'vision', 'insert']);
  assert.deepEqual(c.phonics.map((p) => p.pattern), ['-ture', '-sion', 'in-']);
  assert.deepEqual(c.mnemonics, { creature: '크리처', insert: '인서트' });
  assert.equal(c.count, 2);
  assert.deepEqual(combineWordSets(null).words, []);
});
