// api/_lib/wordsets-handler.mjs
// GET    /api/wordsets          공유 저장된 단어장 목록 (최근 5개)
// POST   /api/wordsets {set}    단어장 올리기 (같은 id 면 교체). 비밀번호 필요
// DELETE /api/wordsets?id=...   단어장 지우기. 비밀번호 필요
//
// store 는 { enabled, load(), update(mutate, message) } 모양 (api/_lib/github.mjs). 테스트는 가짜를 넣는다.

import { addWordSet, removeWordSet, toRemoteWordSet, wordSetTitle, MAX_REMOTE_WORDSETS } from '../../shared/wordsets.mjs';
import { sanitizeWords } from '../../shared/wordlab-logic.mjs';

function send(res, status, body) {
  res.status(status).json(body);
}

function checkPasscode(req, res, passcode) {
  if (!passcode) return true;
  if (String(req.headers?.['x-passcode'] ?? '') === passcode) return true;
  send(res, 401, { error: '비밀번호가 맞지 않아요. 아빠에게 물어보세요.', needPasscode: true });
  return false;
}

const DISABLED_MSG = '다른 기기 저장이 꺼져 있어요. 이 기기에는 저장됐어요.';
const FAILED_MSG = '다른 기기에는 저장하지 못했어요. 이 기기에는 저장됐어요. 잠시 뒤 다시 열면 맞춰져요.';

export function makeWordSetsHandler({ store, passcode } = {}) {
  return async function wordSetsHandler(req, res) {
    const method = req.method;

    if (method === 'GET') {
      if (!store?.enabled) return send(res, 200, { sets: [], disabled: true });
      try {
        return send(res, 200, { sets: await store.load() });
      } catch (err) {
        console.error('[wordsets GET]', err?.status ?? '', err?.message ?? err);
        return send(res, 502, { error: '다른 기기의 단어장을 불러오지 못했어요. 이 기기 것만 보여요.' });
      }
    }

    if (method === 'POST') {
      if (!checkPasscode(req, res, passcode)) return;
      const set = toRemoteWordSet(req.body?.set);
      if (!set) return send(res, 400, { error: '저장할 단어장이 비었어요.' });
      set.words = sanitizeWords(set.words);
      if (set.words.length === 0) return send(res, 400, { error: '저장할 단어장이 비었어요.' });
      if (!store?.enabled) return send(res, 503, { error: DISABLED_MSG, disabled: true });
      try {
        const sets = await store.update(
          (current) => addWordSet(current, set, MAX_REMOTE_WORDSETS),
          '단어장 저장: ' + wordSetTitle(set)
        );
        return send(res, 200, { sets });
      } catch (err) {
        console.error('[wordsets POST]', err?.status ?? '', err?.message ?? err);
        return send(res, 502, { error: FAILED_MSG });
      }
    }

    if (method === 'DELETE') {
      if (!checkPasscode(req, res, passcode)) return;
      const id = String(req.query?.id ?? req.body?.id ?? '').trim();
      if (!id) return send(res, 400, { error: '어느 단어장인지 알 수 없어요.' });
      if (!store?.enabled) return send(res, 503, { error: DISABLED_MSG, disabled: true });
      try {
        const sets = await store.update((current) => removeWordSet(current, id), '단어장 삭제: ' + id);
        return send(res, 200, { sets });
      } catch (err) {
        console.error('[wordsets DELETE]', err?.status ?? '', err?.message ?? err);
        return send(res, 502, { error: '다른 기기에서는 지우지 못했어요. 이 기기에서는 지워졌어요.' });
      }
    }

    return send(res, 405, { error: '이 주소는 단어장을 저장하고 불러올 때만 써요.' });
  };
}
