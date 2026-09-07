// api/_lib/claude.mjs
// 서버에서만 실행된다. API 키는 환경변수(ANTHROPIC_API_KEY)에서 SDK 가 읽는다.
// scripts/compare-models.mjs 도 같은 makeCallModel 을 써서 실제 앱과 같은 옵션으로 모델을 비교한다.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
export const EFFORT = process.env.CLAUDE_EFFORT || 'medium';

/** effort 옵션을 받는 모델인가. Haiku 4.5 와 4.5 이전 Sonnet 은 400 을 돌려준다 */
export function supportsEffort(model) {
  return !/haiku|sonnet-4-5|-3-/.test(model);
}

/** 안전 분류기가 거절하면 서버가 다른 모델로 이어서 답하는 옵션 (Opus 5 / Fable 계열만) */
export function fallbackOptions(model) {
  if (/^claude-(opus-5|fable)/.test(model)) {
    return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  }
  return {};
}

/**
 * shared/extract-service 가 기대하는 모양의 모델 호출 함수를 만든다.
 * JSON 스키마를 output_config 로 강제하되, 응답 해석은 extract-logic 의 4단계를 그대로 거친다.
 * onResponse(message, meta) 를 주면 토큰 사용량·소요 시간을 받을 수 있다 (비교 스크립트용).
 */
export function makeCallModel({ model = MODEL, effort = EFFORT, client, onResponse } = {}) {
  let c = client ?? null;
  const getClient = () => (c ??= new Anthropic({ timeout: 55_000, maxRetries: 1 }));

  return async function callModel({ system, content, schema, maxTokens = 8000 }) {
    const output_config = { format: { type: 'json_schema', schema } };
    if (effort && supportsEffort(model)) output_config.effort = effort;
    const started = Date.now();
    const message = await getClient().beta.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      output_config,
      ...fallbackOptions(model),
    });
    if (onResponse) onResponse(message, { model, ms: Date.now() - started });
    return message;
  };
}

/** 서버 함수가 쓰는 기본 호출 함수 (환경변수의 모델·effort) */
export const callModel = makeCallModel();

export { Anthropic };
