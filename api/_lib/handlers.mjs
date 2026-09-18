// api/_lib/handlers.mjs
// Vercel 서버리스 함수의 본체. (req, res) 를 받는 핸들러를 만들어 돌려준다.
// callModel 과 passcode 를 주입받으므로 SDK 없이 테스트할 수 있다.

import { extractWordsFromImage, extractPhonicsRules, extractStory } from '../../shared/extract-service.mjs';
import { extractPassageFromImage, generateQuestions, translateSentences } from '../../shared/passage-service.mjs';
import { cleanPassage, splitSentences, MAX_PASSAGE_CHARS, MAX_TRANSLATE_SENTENCES } from '../../shared/passage-logic.mjs';

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
    const image = imageFromBody(body, res);
    if (!image) return;

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

/** body.image 를 검사한다. 잘못됐으면 4xx 를 보내고 null */
function imageFromBody(body, res) {
  const image = body.image;
  if (!image || typeof image.data !== 'string' || !image.data) {
    send(res, 400, { error: '사진이 들어오지 않았어요. 다시 골라주세요.' });
    return null;
  }
  if (!IMAGE_TYPES.has(image.mediaType)) {
    send(res, 400, { error: '이 사진 형식은 읽을 수 없어요. JPG나 PNG로 보내주세요.' });
    return null;
  }
  if (image.data.length > MAX_IMAGE_BASE64) {
    send(res, 413, { error: '사진이 너무 커요. 조금 작게 찍어서 다시 올려주세요.' });
    return null;
  }
  return image;
}

/** body.words 를 정리한다. 없으면 400 을 보내고 null */
function wordsFromBody(body, res) {
  const words = Array.isArray(body.words)
    ? body.words
        .filter((w) => w && typeof w.word === 'string' && w.word.trim())
        .map((w) => ({ word: w.word.trim(), meaning: String(w.meaning ?? '').trim(), chunks: w.chunks }))
        .slice(0, MAX_PHONICS_WORDS)
    : [];
  if (words.length === 0) {
    send(res, 400, { error: '단어가 없어요. 먼저 사진에서 단어를 뽑아주세요.' });
    return null;
  }
  return words;
}

/**
 * POST /api/extract/phonics
 * body: { words: [{ word, meaning, chunks }] }
 * 200: { phonics: [...], mnemonics: { word: tip }, status }
 */
export function makePhonicsHandler({ callModel, passcode, Anthropic } = {}) {
  return async function phonicsHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;
    const words = wordsFromBody(body, res);
    if (!words) return;

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

/**
 * POST /api/extract/story
 * body: { words: [{ word, meaning, chunks }] }
 * 200: { story, status, used }   — 만들지 못했으면 story 는 '' (학습은 계속)
 */
export function makeStoryHandler({ callModel, passcode, Anthropic } = {}) {
  return async function storyHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;
    const words = wordsFromBody(body, res);
    if (!words) return;

    try {
      const result = await extractStory({ words, callModel });
      return send(res, 200, result);
    } catch (err) {
      const { status, error } = describeModelError(err, Anthropic);
      console.error('[story]', err?.status ?? '', err?.message ?? err);
      return send(res, status, { error });
    }
  };
}

/**
 * POST /api/extract/passage
 * body: { image: { data: base64, mediaType } }
 * 200: { title, passage, sentences, questions, dropped, status, calls }
 */
export function makePassageHandler({ callModel, passcode, Anthropic } = {}) {
  return async function passageHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;
    const image = imageFromBody(body, res);
    if (!image) return;

    try {
      const result = await extractPassageFromImage({ image, callModel });
      if (result.status === 'refused') {
        return send(res, 422, { error: '이 사진은 읽을 수 없었어요. 지문 페이지만 나오게 다시 찍어주세요.' });
      }
      if (!result.passage) {
        return send(res, 422, { error: '지문을 찾지 못했어요. 글자가 잘 보이게 다시 찍어주세요.' });
      }
      return send(res, 200, result);
    } catch (err) {
      const { status, error } = describeModelError(err, Anthropic);
      console.error('[passage]', err?.status ?? '', err?.message ?? err);
      return send(res, status, { error });
    }
  };
}

/**
 * POST /api/extract/questions
 * body: { passage, avoid?: string[] }
 * 200: { questions, dropped, status, calls }
 * 사진을 다시 읽지 않으므로 "문제 다시 만들기" 를 눌러도 지문 분석 비용이 들지 않는다.
 */
export function makeQuestionsHandler({ callModel, passcode, Anthropic } = {}) {
  return async function questionsHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;

    const passage = cleanPassage(body.passage);
    if (!passage) {
      return send(res, 400, { error: '지문이 없어요. 먼저 사진에서 지문을 뽑아주세요.' });
    }
    if (String(body.passage).length > MAX_PASSAGE_CHARS * 2) {
      return send(res, 413, { error: '지문이 너무 길어요. 한 쪽씩 나눠서 올려주세요.' });
    }
    const sentences = splitSentences(passage);
    const avoid = (Array.isArray(body.avoid) ? body.avoid : [])
      .filter((s) => typeof s === 'string' && s.trim())
      .slice(0, 30);

    try {
      const result = await generateQuestions({ passage, sentences, avoid, callModel });
      return send(res, 200, result);
    } catch (err) {
      const { status, error } = describeModelError(err, Anthropic);
      console.error('[questions]', err?.status ?? '', err?.message ?? err);
      return send(res, status, { error });
    }
  };
}

/**
 * POST /api/extract/translate
 * body: { sentences: string[] }
 * 200: { translations: string[], status, calls }  — 문장 수와 길이가 같다. 못 받은 자리는 빈 문자열
 */
export function makeTranslateHandler({ callModel, passcode, Anthropic } = {}) {
  return async function translateHandler(req, res) {
    const body = gate(req, res, passcode);
    if (!body) return;

    const sentences = (Array.isArray(body.sentences) ? body.sentences : [])
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim())
      .slice(0, MAX_TRANSLATE_SENTENCES);
    if (sentences.length === 0) {
      return send(res, 400, { error: '문장이 없어요. 먼저 사진에서 지문을 뽑아주세요.' });
    }

    try {
      const result = await translateSentences({ sentences, callModel });
      return send(res, 200, result);
    } catch (err) {
      const { status, error } = describeModelError(err, Anthropic);
      console.error('[translate]', err?.status ?? '', err?.message ?? err);
      return send(res, status, { error });
    }
  };
}
