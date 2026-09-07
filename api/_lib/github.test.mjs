import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGitHubStore } from './github.mjs';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

/** 요청을 기록하고 정해진 응답을 돌려주는 가짜 fetch. route(method, path) → 응답 */
function fakeFetch(route) {
  const calls = [];
  const fn = async (url, init) => {
    const path = url.replace('https://api.github.com/repos/o/r', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body, auth: init.headers.Authorization });
    return route(init.method, path, body, calls.length);
  };
  return { fn, calls };
}

test('enabled: 토큰과 저장소가 모두 있어야 켜진다', () => {
  assert.equal(makeGitHubStore({ token: 't', repo: 'o/r' }).enabled, true);
  assert.equal(makeGitHubStore({ token: '', repo: 'o/r' }).enabled, false);
  assert.equal(makeGitHubStore({ token: 't' }).enabled, false);
});

test('load: 파일이 없으면(404) 빈 목록, 있으면 base64 를 풀어 sets 를 돌려준다', async () => {
  let exists = false;
  const { fn, calls } = fakeFetch((m, p) => {
    if (!exists) return json(404, { message: 'Not Found' });
    return json(200, { sha: 'abc', content: b64({ sets: [{ id: 'a', at: 1, words: [], phonics: [] }] }) });
  });
  const store = makeGitHubStore({ token: 't', repo: 'o/r', fetchImpl: fn });
  assert.deepEqual(await store.load(), []);
  exists = true;
  assert.equal((await store.load())[0].id, 'a');
  assert.match(calls[0].path, /^\/contents\/wordsets\.json\?ref=data$/);
  assert.equal(calls[0].auth, 'Bearer t');
});

test('update: 브랜치가 없으면 main 에서 만들고, 읽은 sha 로 쓴다', async () => {
  const { fn, calls } = fakeFetch((m, p, body) => {
    if (m === 'GET' && p === '/git/ref/heads/data') return json(404, {});
    if (m === 'GET' && p === '/git/ref/heads/main') return json(200, { object: { sha: 'mainsha' } });
    if (m === 'POST' && p === '/git/refs') return json(201, {});
    if (m === 'GET' && p.startsWith('/contents/')) return json(200, { sha: 'filesha', content: b64({ sets: [{ id: 'old' }] }) });
    if (m === 'PUT' && p === '/contents/wordsets.json') return json(200, {});
    throw new Error('unexpected ' + m + ' ' + p);
  });
  const store = makeGitHubStore({ token: 't', repo: 'o/r', fetchImpl: fn });
  const next = await store.update((sets) => [{ id: 'new' }, ...sets], '저장');
  assert.deepEqual(next.map((s) => s.id), ['new', 'old']);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.sha, 'filesha');
  assert.equal(put.body.branch, 'data');
  assert.equal(put.body.message, '저장');
  const written = JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8'));
  assert.deepEqual(written.sets.map((s) => s.id), ['new', 'old']);
  const mkBranch = calls.find((c) => c.method === 'POST');
  assert.deepEqual(mkBranch.body, { ref: 'refs/heads/data', sha: 'mainsha' });
});

test('update: 충돌(409)이면 다시 읽어 한 번 재시도한다', async () => {
  let puts = 0;
  const { fn } = fakeFetch((m, p) => {
    if (m === 'GET' && p === '/git/ref/heads/data') return json(200, {});
    if (m === 'GET' && p.startsWith('/contents/')) return json(200, { sha: 'sha' + puts, content: b64({ sets: [] }) });
    if (m === 'PUT') {
      puts++;
      return puts === 1 ? json(409, {}) : json(200, {});
    }
    throw new Error('unexpected');
  });
  const store = makeGitHubStore({ token: 't', repo: 'o/r', fetchImpl: fn });
  const next = await store.update((sets) => [{ id: 'x' }, ...sets], 'm');
  assert.equal(puts, 2);
  assert.equal(next[0].id, 'x');
});

test('update: 두 번 다 충돌하거나 다른 오류면 던진다', async () => {
  const { fn } = fakeFetch((m, p) => {
    if (m === 'GET' && p === '/git/ref/heads/data') return json(200, {});
    if (m === 'GET' && p.startsWith('/contents/')) return json(200, { sha: 's', content: b64({ sets: [] }) });
    if (m === 'PUT') return json(409, {});
    throw new Error('unexpected');
  });
  const store = makeGitHubStore({ token: 't', repo: 'o/r', fetchImpl: fn });
  await assert.rejects(store.update((s) => s, 'm'), /동시에 저장됨/);

  const bad = makeGitHubStore({
    token: 't',
    repo: 'o/r',
    fetchImpl: fakeFetch((m, p) => (p.startsWith('/git/ref') ? json(200, {}) : json(401, {}))).fn,
  });
  await assert.rejects(bad.update((s) => s, 'm'), /읽기 실패 401/);
});
