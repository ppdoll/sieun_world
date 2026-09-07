import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth, makeHealthHandler } from './health.mjs';

test('buildHealth: 비밀값은 내보내지 않고 켜짐 여부만 알린다', () => {
  const h = buildHealth(
    {
      CLAUDE_MODEL: 'claude-sonnet-5',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      APP_PASSCODE: '1234',
      GITHUB_TOKEN: 'github_pat_secret',
      VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
    },
    () => new Date('2026-09-07T00:00:00Z')
  );
  assert.equal(h.model, 'claude-sonnet-5');
  assert.equal(h.effort, 'medium');
  assert.equal(h.apiKey, true);
  assert.equal(h.passcodeRequired, true);
  assert.equal(h.sharedStorage, true);
  assert.equal(h.sharedRepo, 'ppdoll/sieun_world');
  assert.equal(h.deployment, 'abcdef1');
  const text = JSON.stringify(h);
  assert.doesNotMatch(text, /secret|1234|sk-ant|github_pat/);
});

test('buildHealth: 비어 있으면 기본값과 꺼짐', () => {
  const h = buildHealth({});
  assert.equal(h.model, 'claude-opus-5');
  assert.equal(h.apiKey, false);
  assert.equal(h.sharedStorage, false);
  assert.equal(h.sharedRepo, null);
  assert.equal(h.deployment, null);
});

test('health handler: GET 만 200, 나머지 405', () => {
  const handler = makeHealthHandler({ env: { CLAUDE_MODEL: 'claude-sonnet-5' } });
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => ((res.body = o), res);
  res.setHeader = (k, v) => (res.headers[k] = v);
  handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.model, 'claude-sonnet-5');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});
