// shared/passage-service.mjs
// 독해 추출 흐름의 조율. 모델 호출 함수(callModel)를 주입받으므로 SDK 없이 테스트할 수 있다.

import {
  PASSAGE_SCHEMA,
  PASSAGE_SYSTEM,
  QUESTIONS_SCHEMA,
  QUESTIONS_SYSTEM,
  passagePrompt,
  questionsPrompt,
  parsePassageResponse,
  parseQuestionsResponse,
  mergeQuestions,
  splitSentences,
} from './passage-logic.mjs';

/** 모의 문제를 이만큼 못 건지면 한 번 더 만들어 채운다 */
export const MIN_QUESTIONS = 6;
export const TARGET_QUESTIONS = 10;

/**
 * 사진 한 장에서 지문과 교재 문제를 뽑는다.
 * 1) 정상이면 끝
 * 2) 거절이면 즉시 중단 (다시 물어도 같다)
 * 3) 잘렸거나 JSON 이 깨졌으면 한 번만 다시 묻는다
 *
 * @returns {{status, title, passage, sentences, questions, dropped, calls}}
 */
export async function extractPassageFromImage({ image, callModel }) {
  let calls = 0;
  const ask = async () => {
    calls++;
    return parsePassageResponse(
      await callModel({
        system: PASSAGE_SYSTEM,
        schema: PASSAGE_SCHEMA,
        maxTokens: 12000,
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: passagePrompt() },
        ],
      })
    );
  };

  const first = await ask();
  if (first.status === 'ok' || first.status === 'refused') return { ...first, calls };

  const second = await ask();
  // 두 번째가 더 나으면 그것을, 아니면 첫 번째에서 건진 것을 쓴다
  const better = second.status === 'ok' || (second.passage && !first.passage) ? second : first;
  return { ...better, calls };
}

/**
 * 지문 → 모의 문제. 검증을 통과한 문제가 모자라면 한 번 더 만들어 채운다.
 * 실패해도 빈 배열을 돌려준다 (교재 문제만으로도 연습은 된다).
 *
 * @returns {{status, questions, dropped, calls}}
 */
export async function generateQuestions({ passage, sentences, avoid = [], callModel }) {
  const lines = Array.isArray(sentences) && sentences.length ? sentences : splitSentences(passage);
  let calls = 0;
  const ask = async (skip) => {
    calls++;
    return parseQuestionsResponse(
      await callModel({
        system: QUESTIONS_SYSTEM,
        schema: QUESTIONS_SCHEMA,
        maxTokens: 8000,
        content: [{ type: 'text', text: questionsPrompt(passage, skip) }],
      }),
      lines
    );
  };

  const first = await ask(avoid);
  if (first.status === 'refused') return { ...first, calls };
  if (first.questions.length >= MIN_QUESTIONS) return { ...first, calls };

  // 검증에서 많이 걸러졌다. 이미 나온 질문은 빼고 한 번 더 채운다
  const asked = [...avoid, ...first.questions.map((q) => q.question)];
  const second = await ask(asked);
  const questions = mergeQuestions(first.questions, second.questions).slice(0, TARGET_QUESTIONS);
  return {
    status: questions.length ? 'ok' : second.status,
    questions,
    dropped: first.dropped + second.dropped,
    calls,
  };
}
