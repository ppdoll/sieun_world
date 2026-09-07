import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWordSetsHandler } from './wordsets-handler.mjs';

function mockReq({ method = 'GET', body, headers = {}, query = {} } = {}) {
  return { method, body, headers, query };
}
function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => ((res.body = o), res);
  return res;
}

/** 메모리 저장소. update 는 실제 store 처럼 mutate 를 적용한다 */
function memStore(initial = [], { enabled = true, fail = false } = {}) {
  let sets = initial;
  const messages = [];
  return {
    enabled,
    messages,
    async load() {
      if (fail) throw new Error('boom');
      return sets;
    },
    async update(mutate, message) {
      if (fail) throw new Error('boom');
      sets = mutate(sets);
      messages.push(message);
      return sets;
    },
  };
}

const SET = (id, at) => ({ id, at, words: [{ word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] }], phonics: [] });

test('GET: 목록을 돌려준다. 저장소가 꺼져 있으면 빈 목록과 disabled', async () => {
  let res = mockRes();
  await makeWordSetsHandler({ store: memStore([SET('a', 1)]) })(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sets.length, 1);

  res = mockRes();
  await makeWordSetsHandler({ store: memStore([], { enabled: false }) })(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { sets: [], disabled: true });
});

test('POST: 단어장을 앞에 넣고 5개까지만 남긴다. 커밋 메시지에 제목이 들어간다', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const store = memStore([SET('e', 5), SET('d', 4), SET('c', 3), SET('b', 2), SET('a', 1)]);
    const handler = makeWordSetsHandler({ store });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { set: { ...SET('f', 6), synced: true, junk: 1 } } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.sets.map((s) => s.id), ['f', 'e', 'd', 'c', 'b']);
    assert.equal('synced' in res.body.sets[0], false);
    assert.match(store.messages[0], /^단어장 저장: .*creature/);
  } finally {
    console.error = origError;
  }
});

test('POST: 비밀번호가 있으면 검사한다', async () => {
  const handler = makeWordSetsHandler({ store: memStore(), passcode: '1234' });
  let res = mockRes();
  await handler(mockReq({ method: 'POST', body: { set: SET('a', 1) } }), res);
  assert.equal(res.statusCode, 401);
  res = mockRes();
  await handler(mockReq({ method: 'POST', body: { set: SET('a', 1) }, headers: { 'x-passcode': '1234' } }), res);
  assert.equal(res.statusCode, 200);
});

test('POST: 빈 단어장은 400, 저장소가 꺼져 있으면 503 + disabled, 실패하면 502', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    let res = mockRes();
    await makeWordSetsHandler({ store: memStore() })(mockReq({ method: 'POST', body: { set: { id: 'x', words: [] } } }), res);
    assert.equal(res.statusCode, 400);

    res = mockRes();
    await makeWordSetsHandler({ store: memStore([], { enabled: false }) })(mockReq({ method: 'POST', body: { set: SET('a', 1) } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.disabled, true);

    res = mockRes();
    await makeWordSetsHandler({ store: memStore([], { fail: true }) })(mockReq({ method: 'POST', body: { set: SET('a', 1) } }), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /이 기기에는 저장됐어요/);
  } finally {
    console.error = origError;
  }
});

test('DELETE: query 의 id 로 지운다. id 가 없으면 400', async () => {
  const store = memStore([SET('a', 1), SET('b', 2)]);
  const handler = makeWordSetsHandler({ store });
  let res = mockRes();
  await handler(mockReq({ method: 'DELETE', query: { id: 'a' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.sets.map((s) => s.id), ['b']);
  res = mockRes();
  await handler(mockReq({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 400);
});

test('그 외 메서드는 405', async () => {
  const res = mockRes();
  await makeWordSetsHandler({ store: memStore() })(mockReq({ method: 'PATCH' }), res);
  assert.equal(res.statusCode, 405);
});
