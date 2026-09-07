# Vercel 배포 안내

이 앱은 Vercel 한 프로젝트에 프론트(Vite + React)와 서버 함수(`api/`)가 함께 올라간다.
Anthropic API 키는 서버 함수에서만 쓰이고 브라우저에는 내려가지 않는다.

---

## 1. 준비물

- Node 20 이상 (로컬 확인용)
- Vercel 계정, `npm i -g vercel` (또는 `npx vercel`)
- Anthropic API 키

## 2. 로컬에서 확인

```bash
npm install
```

```bash
npm test
```

로컬에서 사진 추출까지 돌려보려면 `.env.local` 에 키를 적고 `vercel dev` 로 띄운다.
`vercel dev` 가 Vite 개발 서버와 `api/` 함수를 한 포트에서 같이 실행한다.

```bash
cp .env.example .env.local
```

```bash
npx vercel dev
```

`npm run dev`(Vite만)로 띄우면 `/api` 요청은 3000번 포트로 넘긴다. 이때는 `vercel dev --listen 3000` 을 따로 띄워야 한다.

## 3. 첫 배포

```bash
npx vercel
```

- 프레임워크는 Vite 로 자동 인식된다. 빌드 명령 `vite build`, 출력 `dist`
- `api/extract/index.js`, `api/extract/phonics.js` 가 서버리스 함수로 올라간다
- 처음 한 번은 프로젝트 이름과 팀만 답하면 된다

## 4. 환경변수 (Vercel 대시보드 → Settings → Environment Variables)

| 이름 | 필수 | 뜻 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 예 | 서버 함수가 쓰는 키 |
| `CLAUDE_MODEL` | 아니오 | 기본 `claude-opus-5`. 비용을 낮추려면 `claude-sonnet-5` |
| `CLAUDE_EFFORT` | 아니오 | 기본 `medium`. `low` 면 더 빠르고 싸다 |
| `APP_PASSCODE` | 아니오 | 넣으면 사진 추출 시 이 비밀번호를 요구한다 (§6) |

환경변수를 바꾼 뒤에는 다시 배포해야 반영된다.

```bash
npx vercel --prod
```

## 5. 배포 후 확인

1. 배포 URL 을 **아이가 쓸 기기**에서 연다
2. 사진 한 장을 올려 검수 화면까지 온다
3. 덩어리 읽기 화면에서 소리가 나는지 확인한다 (README §7 TTS 편차)
4. 받아쓰기 문제가 나오는지 확인한다. 영어 목소리가 없는 기기에서는 자동으로 빠진다

## 6. 접근 제한

로그인은 없다. URL 을 아는 사람만 쓰는 전제다. URL 이 새어 나가면 남이 내 키로 사진 추출을 돌릴 수 있으므로, `APP_PASSCODE` 를 넣어두는 쪽을 권한다.

- 처음 사진을 올릴 때 한 번 비밀번호를 물어본다. 그 기기의 브라우저에 저장되어 다음부터는 묻지 않는다
- 시험·복습 등 학습 화면은 비밀번호 없이 그대로 동작한다 (서버를 부르지 않는다)
- 더 강한 보호가 필요하면 Vercel 의 Deployment Protection(비밀번호 보호)을 켠다. 유료 기능이다

## 7. 한도와 비용

- Vercel 함수 실행 시간은 `vercel.json` 에서 60초로 잡았다. Hobby 플랜 한도 안이다
- 요청 본문 한도는 4.5MB. 브라우저가 사진을 긴 변 1600px JPEG 로 줄여서 보내므로 보통 300~600KB 다
- 사진 한 장당 모델 호출은 1회, 응답이 잘리면 최대 3회. 파닉스 규칙은 단어장당 1회
- 하루 호출 상한은 아직 없다 (CHECKLIST B-5). 서버리스는 요청 간 상태를 공유하지 않아서 DB 나 KV 가 붙어야 걸 수 있다

## 8. 사진은 저장되지 않는다

사진은 base64 로 함수에 들어와 모델에 넘겨지고 응답이 오면 사라진다. 디스크, 로그, 외부 저장소에 남기지 않는다. 브라우저에도 단어·뜻·덩어리 텍스트만 `localStorage` 에 남는다.
