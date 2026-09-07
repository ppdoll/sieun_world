import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssembly, gradeAssembly } from './assembly.mjs';

const WORDS = [
  { word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] },
  { word: 'strength', meaning: '힘', chunks: ['strength'] },
  { word: 'material', meaning: '재료', chunks: ['ma', 'te', 'ri', 'al'] },
  { word: 'banana', meaning: '바나나', chunks: ['ba', 'na', 'na'] },
];

test('buildAssembly: 덩어리가 2개 이상인 단어만, 원래 순서대로 낸다', () => {
  const items = buildAssembly(WORDS, { seed: 3 });
  assert.deepEqual(items.map((x) => x.word), ['creature', 'material', 'banana']);
  assert.deepEqual(items[1].chunks, ['ma', 'te', 'ri', 'al']);
});

test('buildAssembly: pool 은 원래 덩어리를 전부 담되 순서는 정답과 다르다', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const item of buildAssembly(WORDS, { seed })) {
      const idx = item.pool.map((p) => p.i);
      assert.deepEqual([...idx].sort((a, b) => a - b), item.chunks.map((_, i) => i), 'seed ' + seed);
      assert.notDeepEqual(idx, item.chunks.map((_, i) => i), '이미 맞춰진 채로 나오면 안 됨 seed ' + seed);
      assert.deepEqual(item.pool.map((p) => item.chunks[p.i]), item.pool.map((p) => p.c));
    }
  }
});

test('buildAssembly: 같은 seed 는 같은 문제, 빈 입력은 빈 배열', () => {
  assert.deepEqual(buildAssembly(WORDS, { seed: 7 }), buildAssembly(WORDS, { seed: 7 }));
  assert.deepEqual(buildAssembly(null), []);
  assert.deepEqual(buildAssembly([WORDS[1]]), []);
});

test('gradeAssembly: 전부 순서대로면 정답', () => {
  const g = gradeAssembly(['ma', 'te', 'ri', 'al'], ['ma', 'te', 'ri', 'al']);
  assert.deepEqual(g, { correct: true, complete: true, matchedChunks: 4 });
});

test('gradeAssembly: 앞에서 맞은 덩어리 수를 센다', () => {
  const g = gradeAssembly(['ma', 'te', 'ri', 'al'], ['ma', 'te', 'al', 'ri']);
  assert.equal(g.correct, false);
  assert.equal(g.complete, true);
  assert.equal(g.matchedChunks, 2);
});

test('gradeAssembly: 아직 다 안 골랐으면 complete false', () => {
  const g = gradeAssembly(['crea', 'ture'], ['crea']);
  assert.deepEqual(g, { correct: false, complete: false, matchedChunks: 1 });
});

test('gradeAssembly: 같은 글자 덩어리는 어느 쪽을 눌러도 맞는다 (글자로 비교)', () => {
  assert.equal(gradeAssembly(['ba', 'na', 'na'], ['ba', 'na', 'na']).correct, true);
  assert.equal(gradeAssembly(['Crea', 'ture'], ['crea', 'ture']).correct, true);
});
