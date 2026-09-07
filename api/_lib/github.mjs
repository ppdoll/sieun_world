// api/_lib/github.mjs
// 공유 저장소: GitHub 저장소의 별도 브랜치(data)에 있는 JSON 파일 하나.
// DB 없이 다른 기기와 단어장을 나누기 위한 것이다. 매 저장이 커밋 하나가 되어 이력도 남는다.
//
// 필요한 환경변수: GITHUB_TOKEN (Contents 읽기/쓰기 권한의 fine-grained 토큰)
// 선택: GITHUB_REPO (기본 ppdoll/sieun_world), GITHUB_DATA_BRANCH (기본 data)

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.repo  "owner/name"
 * @param {string} [opts.branch]  데이터 브랜치
 * @param {string} [opts.baseBranch]  데이터 브랜치가 없을 때 갈라 나올 브랜치
 * @param {string} [opts.path]  JSON 파일 경로
 * @param {Function} [opts.fetchImpl]  테스트용 fetch 대체
 */
export function makeGitHubStore({
  token,
  repo,
  branch = 'data',
  baseBranch = 'main',
  path = 'wordsets.json',
  fetchImpl = globalThis.fetch,
} = {}) {
  const enabled = !!(token && repo);
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sieun-word-lab',
    'Content-Type': 'application/json',
  };
  const url = (p) => API + '/repos/' + repo + p;

  async function call(method, p, body) {
    const res = await fetchImpl(url(p), { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  }

  /** 파일 읽기 → { sets, sha }. 없으면 빈 목록 */
  async function read() {
    const r = await call('GET', '/contents/' + path + '?ref=' + encodeURIComponent(branch));
    if (r.status === 404) return { sets: [], sha: null };
    if (!r.ok) throw new GitHubError('GitHub 읽기 실패 ' + r.status, r.status);
    const text = Buffer.from(String(r.data?.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { sets: Array.isArray(parsed?.sets) ? parsed.sets : [], sha: r.data?.sha ?? null };
  }

  /** 데이터 브랜치가 없으면 baseBranch 끝에서 만든다 */
  async function ensureBranch() {
    const ref = await call('GET', '/git/ref/heads/' + encodeURIComponent(branch));
    if (ref.ok) return false;
    if (ref.status !== 404) throw new GitHubError('브랜치 확인 실패 ' + ref.status, ref.status);
    const base = await call('GET', '/git/ref/heads/' + encodeURIComponent(baseBranch));
    if (!base.ok) throw new GitHubError('기준 브랜치 없음 ' + base.status, base.status);
    const made = await call('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: base.data.object.sha });
    if (!made.ok && made.status !== 422) throw new GitHubError('브랜치 생성 실패 ' + made.status, made.status);
    return true;
  }

  /** 파일 쓰기. sha 가 맞지 않으면(다른 기기가 먼저 썼으면) 409/422 → GitHubError(conflict) */
  async function write(sets, sha, message) {
    const content = Buffer.from(JSON.stringify({ sets }, null, 2) + '\n', 'utf8').toString('base64');
    const body = { message, content, branch };
    if (sha) body.sha = sha;
    const r = await call('PUT', '/contents/' + path, body);
    if (r.status === 409 || r.status === 422) {
      const err = new GitHubError('동시에 저장됨', r.status);
      err.conflict = true;
      throw err;
    }
    if (!r.ok) throw new GitHubError('GitHub 쓰기 실패 ' + r.status, r.status);
  }

  return {
    enabled,
    /** 현재 목록 */
    async load() {
      return (await read()).sets;
    },
    /**
     * 읽고 → mutate(sets) 로 바꾸고 → 쓴다. 충돌하면 한 번 다시 읽어서 재시도한다.
     * @returns 저장된 목록
     */
    async update(mutate, message) {
      await ensureBranch();
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { sets, sha } = await read();
        const next = mutate(sets);
        try {
          await write(next, sha, message);
          return next;
        } catch (e) {
          if (!e.conflict) throw e;
          lastErr = e;
        }
      }
      throw lastErr;
    },
  };
}

/** 환경변수로 만든 기본 저장소 */
export function storeFromEnv(env = process.env) {
  return makeGitHubStore({
    token: env.GITHUB_TOKEN || '',
    repo: env.GITHUB_REPO || 'ppdoll/sieun_world',
    branch: env.GITHUB_DATA_BRANCH || 'data',
  });
}
