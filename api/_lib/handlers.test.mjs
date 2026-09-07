import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeExtractHandler,
  makePhonicsHandler,
  describeModelError,
  MAX_IMAGE_BASE64,
} from './handlers.mjs';

/** Vercel 의 (req, res) 를 흉내낸다 */
function mockReq({ method = 'POST', body, headers = {} } = {}) {
  return { method, body, headers };
}
function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.body = obj;
    return res;
  };
  return res;
}

const okModel = (words) => async () => ({
  content: [{ type: 'text', text: JSON.stringify({ words }) }],
  stop_reason: 'end_turn',
});
const IMAGE = { data: 'QUJD', mediaType: 'image/jpeg' };
const WORDS = [{ word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] }];

// 가짜 SDK 오류 클래스 (instanceof 판정만 흉내)
class APIError extends Error {}
class AuthenticationError extends APIError {}
class RateLimitError extends APIError {}
const FakeAnthropic = { APIError, AuthenticationError, RateLimitError };

test('extract: 정상 경로 — 200 과 단어 목록', async () => {
  const handler = makeExtractHandler({ callModel: okModel(WORDS) });
  const res = mockRes();
  await handler(mockReq({ body: { image: IMAGE } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.words.length, 1);
});

test('extract: POST 가 아니면 405', async () => {
  const handler = makeExtractHandler({ callModel: okModel(WORDS) });
  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('extract: 비밀번호가 설정돼 있고 틀리면 401, 맞으면 통과', async () => {
  const handler = makeExtractHandler({ callModel: okModel(WORDS), passcode: '1234' });
  let res = mockRes();
  await handler(mockReq({ body: { image: IMAGE } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.needPasscode, true);

  res = mockRes();
  await handler(mockReq({ body: { image: IMAGE }, headers: { 'x-passcode': '1234' } }), res);
  assert.equal(res.statusCode, 200);
});

test('extract: 사진이 없거나 형식이 다르거나 너무 크면 4xx', async () => {
  const handler = makeExtractHandler({ callModel: okModel(WORDS) });
  const cases = [
    [{}, 400],
    [{ image: { data: '', mediaType: 'image/jpeg' } }, 400],
    [{ image: { data: 'QUJD', mediaType: 'image/heic' } }, 400],
    [{ image: { data: 'A'.repeat(MAX_IMAGE_BASE64 + 1), mediaType: 'image/png' } }, 413],
  ];
  for (const [body, expected] of cases) {
    const res = mockRes();
    await handler(mockReq({ body }), res);
    assert.equal(res.statusCode, expected, JSON.stringify(body).slice(0, 60));
    assert.ok(res.body.error);
  }
});

test('extract: 단어가 0개면 422 와 다시 찍으라는 안내', async () => {
  const handler = makeExtractHandler({ callModel: okModel([]) });
  const res = mockRes();
  await handler(mockReq({ body: { image: IMAGE } }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /다시 찍어/);
});

test('extract: 모델이 거절하면 422', async () => {
  const handler = makeExtractHandler({ callModel: async () => ({ content: [], stop_reason: 'refusal' }) });
  const res = mockRes();
  await handler(mockReq({ body: { image: IMAGE } }), res);
  assert.equal(res.statusCode, 422);
});

test('extract: SDK 오류는 종류별 상태코드와 아이용 문장으로 바뀐다', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    for (const [ErrClass, expected] of [
      [AuthenticationError, 500],
      [RateLimitError, 429],
      [APIError, 502],
    ]) {
      const handler = makeExtractHandler({
        callModel: async () => {
          throw new ErrClass('x');
        },
        Anthropic: FakeAnthropic,
      });
      const res = mockRes();
      await handler(mockReq({ body: { image: IMAGE } }), res);
      assert.equal(res.statusCode, expected, ErrClass.name);
      assert.doesNotMatch(res.body.error, /오류가 발생/);
    }
  } finally {
    console.error = origError;
  }
});

test('describeModelError: 크레딧 부족은 402 와 충전 안내, 그 외 400 은 설정 문제로 알린다', () => {
  const low = new APIError('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}');
  low.status = 400;
  const r = describeModelError(low, FakeAnthropic);
  assert.equal(r.status, 402);
  assert.match(r.error, /충전/);
  assert.doesNotMatch(r.error, /한 번 더/);

  const bad = new APIError('400 invalid_request_error');
  bad.status = 400;
  assert.equal(describeModelError(bad, FakeAnthropic).status, 500);

  const down = new APIError('529 overloaded');
  down.status = 529;
  assert.equal(describeModelError(down, FakeAnthropic).status, 502);
});

test('describeModelError: 시간 초과는 504, 알 수 없는 오류는 500', () => {
  assert.equal(describeModelError(new Error('Request timeout'), FakeAnthropic).status, 504);
  assert.equal(describeModelError(new Error('???'), FakeAnthropic).status, 500);
  assert.equal(describeModelError(null, undefined).status, 500);
});

test('phonics: 정상 경로 — 200 과 규칙 배열', async () => {
  const handler = makePhonicsHandler({
    callModel: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            phonics: [{ pattern: '-ture', sound: '처', tip: 't', words: ['creature'] }],
          }),
        },
      ],
      stop_reason: 'end_turn',
    }),
  });
  const res = mockRes();
  await handler(mockReq({ body: { words: WORDS } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.phonics.length, 1);
});

test('phonics: 단어가 없으면 400', async () => {
  const handler = makePhonicsHandler({ callModel: okModel([]) });
  const res = mockRes();
  await handler(mockReq({ body: { words: [] } }), res);
  assert.equal(res.statusCode, 400);
});

test('phonics: 비밀번호 검사도 같이 적용된다', async () => {
  const handler = makePhonicsHandler({ callModel: okModel([]), passcode: 'abcd' });
  const res = mockRes();
  await handler(mockReq({ body: { words: WORDS } }), res);
  assert.equal(res.statusCode, 401);
});
