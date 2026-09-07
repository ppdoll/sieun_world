// api/_lib/health.mjs
// GET /api/health — 배포된 서버의 설정 상태. 비밀값은 절대 내보내지 않고 "켜짐/꺼짐" 만 알린다.
// 환경변수를 바꿔 재배포한 뒤 실제로 반영됐는지 확인하는 용도.

export function buildHealth(env = process.env, now = () => new Date()) {
  return {
    ok: true,
    model: env.CLAUDE_MODEL || 'claude-opus-5',
    effort: env.CLAUDE_EFFORT || 'medium',
    apiKey: !!env.ANTHROPIC_API_KEY,
    passcodeRequired: !!env.APP_PASSCODE,
    sharedStorage: !!env.GITHUB_TOKEN,
    sharedRepo: env.GITHUB_TOKEN ? env.GITHUB_REPO || 'ppdoll/sieun_world' : null,
    sharedBranch: env.GITHUB_TOKEN ? env.GITHUB_DATA_BRANCH || 'data' : null,
    deployment: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    at: now().toISOString(),
  };
}

export function makeHealthHandler({ env = process.env } = {}) {
  return function healthHandler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: '이 주소는 상태를 볼 때만 써요.' });
    }
    res.setHeader?.('Cache-Control', 'no-store');
    return res.status(200).json(buildHealth(env));
  };
}
