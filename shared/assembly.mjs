// shared/assembly.mjs
// 덩어리 조립 연습. 뜻을 보고 섞인 덩어리 칩을 순서대로 눌러 단어를 만든다.
// 시험이 아니라 연습이므로 결과를 채점표에 남기지 않고, 틀리면 바로 다시 맞춘다.

import { makeRng, shuffle } from './wordlab-logic.mjs';

/**
 * 조립 문제 목록. 덩어리가 2개 이상인 단어만 낸다 (1개면 조립할 게 없다).
 * pool 은 섞인 덩어리 [{ c: 글자, i: 원래 위치 }]. 섞은 결과가 원래 순서와 같으면 한 칸 돌린다.
 * 같은 seed 면 같은 문제가 나온다.
 */
export function buildAssembly(words, { seed = 1 } = {}) {
  const rng = makeRng(seed);
  return (Array.isArray(words) ? words : [])
    .filter((w) => Array.isArray(w?.chunks) && w.chunks.length >= 2)
    .map((w) => {
      const items = w.chunks.map((c, i) => ({ c: String(c), i }));
      let pool = shuffle(items, rng);
      if (pool.every((x, k) => x.i === k)) pool = [...pool.slice(1), pool[0]];
      return { word: w.word, meaning: w.meaning, chunks: w.chunks.map(String), pool };
    });
}

/**
 * 조립 채점. picked 는 아이가 누른 순서대로의 덩어리 글자 배열.
 * 같은 글자 덩어리가 두 번 나오는 단어(na-na)도 글자로 비교하므로 어느 쪽을 먼저 눌러도 맞는다.
 * matchedChunks: 앞에서부터 맞은 덩어리 수 (부분 정답 피드백용)
 */
export function gradeAssembly(chunks, picked) {
  const answer = (Array.isArray(chunks) ? chunks : []).map((c) => String(c).toLowerCase());
  const got = (Array.isArray(picked) ? picked : []).map((c) => String(c).toLowerCase());
  let matched = 0;
  while (matched < got.length && matched < answer.length && got[matched] === answer[matched]) matched++;
  const complete = got.length === answer.length;
  return { correct: complete && matched === answer.length, complete, matchedChunks: matched };
}
