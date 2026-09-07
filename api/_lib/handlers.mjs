// api/_lib/handlers.mjs
// Vercel 서버리스 함수의 본체. (req, res) 를 받는 핸들러를 만들어 돌려준다.
// callModel 과 passcode 를 주입받으므로 SDK 없이 테스트할 수 있다.

import { extractWordsFromImage, extractPhonicsRules } from '../../shared/extract-service.mjs';

export const MAX_IMAGE_BASE64 = 3_000_000; // 약 2.2MB. Vercel 요청 본문 한도(4.5MB) 안쪽
export const MAX_PHONICS_WORDS = 80;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function send(res, status, body) {
  res.status(status).json(body);
}

/** 공통 앞단: 메서드, 비밀번호, 본문 */
function gate(req, res, passcode) {
  if (req.method !== 'POST') {
    send(res, 405, { error: '이 주소는 사진을 보낼 때만 써요.' });
    return null;
  }
  if (passcode) {
    const given = String(req.headers?.['x-passcode'] ?? '');
    if (given !== passcode) {
      send(res, 401, { error: '비밀번호가 맞지 않아요. 아빠에게 물어보세요.', needPasscode: true });
      return null;
    }
  }
  const body = req.body;
  if (!body || typeof body !== 'object') {
    send(res, 400, { error: '보낸 내용을 읽지 못했어요. 다시 시도해 주세요.' });
    return null;
  }
  return body;
}

/** SDK 오류 → 아이가 읽을 수 있는 문장 */
export function describeModelError(err, Anthropic) {
  if (Anthropic && err instanceof Anthropic.AuthenticationError) {
    return { status: 500, error: '서버 설정에 문제가 있어요. 아빠에게 알려주세요.' };
  }
  if (Anthropic && err instanceof Anthropic.RateLimitError) {
    return { status: 429, error: '지금은 너무 바빠요. 잠깐 뒤에 다시 눌러주세요.' };
  }
  // 크레딧 부족은 400 으로 온다. 다시 눌러도 안 되는 문제이므로 아빠가 고쳐야 한다고 알린다
  if (/credit balance|billing/i.test(String(err?.message ?? ''))) {
    return { status: 402, error: '단어 읽기 요금이 다 떨어졌어요. 아빠가 충전해야 해요.' };
  }
  if (Anthropic && err instanceof Anthropic.APIError) {
    if (err.status === 400) {
      return { status: 500, error: '서버 설정에 문제가 있어요. 아빠에게 알려주세요.' };
    }
    return { status: 502, error: '단어를 읽는 곳이 응답하지 않았어요. 한 번 더 눌러주세요.' };
  }
  if (err && (err.name === 'AbortError' || /timeout/i.test(String(err.message)))) {
    return { status: 504, error: '너무 오래 걸렸어요. 사진을 한 장씩 올려보세요.' };
  }
  return { status: 500, error: '잘 되지 않았어요. 한 번 더 눌러주세요.' };
}

/**
 * POST /api/extract
 * body: { image: { data: base64, mediaType } }
 * 200: { words, status: 'ok'|'truncated', split, calls }
 */
export function makeExtractHandler({ callModel, passcode, Anthropic } = {}) {
  return async function extractHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;

    const image = body.image;
    if (!image || typeof image.data !== 'string' || !image.data) {
      return send(res, 400, { error: '사진이 들어오지 않았어요. 다시 골라주세요.' });
    }
    if (!IMAGE_TYPES.has(image.mediaType)) {
      return send(res, 400, { error: '이 사진 형식은 읽을 수 없어요. JPG나 PNG로 보내주세요.' });
    }
    if (image.data.length > MAX_IMAGE_BASE64) {
      return send(res, 413, { error: '사진이 너무 커요. 조금 작게 찍어서 다시 올려주세요.' });
    }

    try {
      const result = await extractWordsFromImage({ image, callModel });
      if (result.status === 'refused') {
        return send(res, 422, { error: '이 사진은 읽을 수 없었어요. 단어장 페이지만 나오게 다시 찍어주세요.' });
      }
      if (result.status === 'unparsable') {
        return send(res, 502, { error: '단어를 읽다가 꼬였어요. 한 번 더 눌러주세요.' });
      }
      if (result.words.length === 0) {
        return send(res, 422, { error: '단어를 찾지 못했어요. 글자가 잘 보이게 다시 찍어주세요.' });
      }
      return send(res, 200, result);
    } catch (err) {
      const { status, error } = describeModelError(err, Anthropic);
      console.error('[extract]', err?.status ?? '', err?.message ?? err);
      return send(res, status, { error });
    }
  };
}

/**
 * POST /api/extract/phonics
 * body: { words: [{ word, meaning, chunks }] }
 * 200: { phonics: [...], status }
 */
export function makePhonicsHandler({ callModel, passcode, Anthropic } = {}) {
  return async function phonicsHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;

    const words = Array.isArray(body.words)
      ? body.words
          .filter((w) => w && typeof w.word === 'string' && w.word.trim())
          .slice(0, MAX_PHONICS_WORDS)
      : [];
    if (words.length === 0) {
      return send(res, 400, { error: '단어가 없어요. 먼저 사진에서 단어를 뽑아주세요.' });
    }

    try {
      const result = await extractPhonicsRules({ words, callModel });
      return send(res, 200, result);
    } catch (err) {
      const { status, error } = describeModelError(err, Anthropic);
      console.error('[phonics]', err?.status ?? '', err?.message ?? err);
      return send(res, status, { error });
    }
  };
}
