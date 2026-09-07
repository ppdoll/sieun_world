// api/_lib/claude.mjs
// 서버에서만 실행된다. API 키는 환경변수(ANTHROPIC_API_KEY)에서 SDK 가 읽는다.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'medium';

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  return client;
}

// 안전 분류기가 거절하면 서버가 다른 모델로 이어서 답하도록 한다 (Opus 5 / Fable 계열).
function fallbackOptions(model) {
  if (/^claude-(opus-5|fable)/.test(model)) {
    return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  }
  return {};
}

/**
 * shared/extract-service 가 기대하는 모양의 모델 호출.
 * JSON 스키마를 output_config 로 강제하되, 응답 해석은 extract-logic 의 4단계를 그대로 거친다.
 */
export async function callModel({ system, content, schema, maxTokens = 8000 }) {
  return getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema }, effort: EFFORT },
    ...fallbackOptions(MODEL),
  });
}

export { Anthropic };
