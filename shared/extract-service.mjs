// shared/extract-service.mjs
// 추출 흐름의 조율. 모델 호출 함수(callModel)를 주입받으므로 SDK 없이 테스트할 수 있다.
//
// callModel({ system, content, schema, maxTokens }) => Promise<Message>
//   Message 는 Anthropic Messages API 응답 모양 ({ content: [...], stop_reason })

import {
  WORDS_SCHEMA,
  WORDS_SYSTEM,
  PHONICS_SCHEMA,
  PHONICS_SYSTEM,
  STORY_SCHEMA,
  STORY_SYSTEM,
  wordsPrompt,
  phonicsPrompt,
  storyPrompt,
  parseWordsResponse,
  parsePhonicsResponse,
  parseStoryResponse,
  mergeWords,
} from './extract-logic.mjs';

function imageRequest(image, region) {
  return {
    system: WORDS_SYSTEM,
    schema: WORDS_SCHEMA,
    content: [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
      { type: 'text', text: wordsPrompt(region) },
    ],
  };
}

/**
 * 사진 한 장에서 단어를 뽑는다.
 * 1) 전체 요청 → 정상이면 끝
 * 2) 잘렸으면(max_tokens) 상반부/하반부로 나눠 다시 묻고 합친다
 * 3) JSON 복구 실패면 한 번만 다시 묻는다
 * 4) 거절(refusal)이면 즉시 중단
 *
 * @returns {{ status: 'ok'|'truncated'|'refused'|'unparsable', words: Array, split: boolean, calls: number }}
 */
export async function extractWordsFromImage({ image, callModel }) {
  let calls = 0;
  const ask = async (region) => {
    calls++;
    return parseWordsResponse(await callModel(imageRequest(image, region)));
  };

  const first = await ask('all');
  if (first.status === 'ok') return { status: 'ok', words: first.words, split: false, calls };
  if (first.status === 'refused') return { status: 'refused', words: [], split: false, calls };

  if (first.status === 'truncated') {
    const [top, bottom] = await Promise.all([ask('top'), ask('bottom')]);
    if (top.status === 'refused' || bottom.status === 'refused') {
      return { status: 'refused', words: [], split: true, calls };
    }
    const words = mergeWords(first.words, top.words, bottom.words);
    const stillCut = top.status === 'truncated' || bottom.status === 'truncated';
    return { status: stillCut ? 'truncated' : 'ok', words, split: true, calls };
  }

  // unparsable → 한 번 더
  const second = await ask('all');
  if (second.status === 'ok') return { status: 'ok', words: second.words, split: false, calls };
  if (second.status === 'truncated') return { status: 'truncated', words: second.words, split: false, calls };
  return { status: second.status, words: [], split: false, calls };
}

/** 단어 목록 → 파닉스 규칙 (최대 5개) + 단어별 연상 한 줄. 실패하면 빈 값 — 학습은 계속된다 */
export async function extractPhonicsRules({ words, callModel }) {
  const message = await callModel({
    system: PHONICS_SYSTEM,
    schema: PHONICS_SCHEMA,
    content: [{ type: 'text', text: phonicsPrompt(words) }],
  });
  return parsePhonicsResponse(message, words);
}

/** 단어 목록 → 단어가 섞인 짧은 한국어 이야기. 약하면(단어 2개 미만) 한 번 더 묻는다 */
export async function extractStory({ words, callModel }) {
  const ask = async () =>
    parseStoryResponse(
      await callModel({
        system: STORY_SYSTEM,
        schema: STORY_SCHEMA,
        content: [{ type: 'text', text: storyPrompt(words) }],
        maxTokens: 2000,
      }),
      words
    );
  const first = await ask();
  if (first.status === 'ok' || first.status === 'refused') return first;
  return ask();
}
