import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWordsFromImage, extractPhonicsRules } from './extract-service.mjs';

const IMG = { data: 'AAAA', mediaType: 'image/jpeg' };
const W = (word, meaning, chunks) => ({ word, meaning, chunks });
const reply = (obj, stop_reason = 'end_turn') => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason,
});

/** 요청 순서대로 응답을 돌려주는 가짜 모델. 프롬프트도 기록한다 */
function fakeModel(responses) {
  const prompts = [];
  const callModel = async (req) => {
    prompts.push(req.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join(' | '));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { callModel, prompts };
}

test('extractWordsFromImage: 정상이면 한 번만 호출하고 끝', async () => {
  const { callModel, prompts } = fakeModel([
    reply({ words: [W('creature', '생명체', ['crea', 'ture'])] }),
  ]);
  const r = await extractWordsFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'ok');
  assert.equal(r.calls, 1);
  assert.equal(r.split, false);
  assert.equal(r.words.length, 1);
  assert.match(prompts[0], /^\[image\] \| 이 페이지의 영단어 항목을 모두/);
});

test('extractWordsFromImage: 잘리면 상/하반부로 나눠 다시 묻고 합친다', async () => {
  const { callModel, prompts } = fakeModel([
    { content: [{ type: 'text', text: '{"words":[{"word":"cre' }], stop_reason: 'max_tokens' },
    reply({ words: [W('creature', '생명체', ['crea', 'ture']), W('vision', '시력', ['vi', 'sion'])] }),
    reply({ words: [W('vision', '시력', ['vi', 'sion']), W('insert', '넣다', ['in', 'sert'])] }),
  ]);
  const r = await extractWordsFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'ok');
  assert.equal(r.split, true);
  assert.equal(r.calls, 3);
  assert.deepEqual(r.words.map((w) => w.word), ['creature', 'vision', 'insert']);
  assert.match(prompts[1], /위쪽 절반/);
  assert.match(prompts[2], /아래쪽 절반/);
});

test('extractWordsFromImage: 나눠서도 잘리면 truncated 로 알리되 건진 단어는 돌려준다', async () => {
  const { callModel } = fakeModel([
    { content: [{ type: 'text', text: '{"words":[' }], stop_reason: 'max_tokens' },
    reply({ words: [W('creature', '생명체', ['crea', 'ture'])] }),
    reply({ words: [W('vision', '시력', ['vi', 'sion'])] }, 'max_tokens'),
  ]);
  const r = await extractWordsFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'truncated');
  assert.equal(r.words.length, 2);
});

test('extractWordsFromImage: JSON 이 깨지면 한 번만 다시 묻는다', async () => {
  const { callModel } = fakeModel([
    { content: [{ type: 'text', text: '사진이 흐려서 못 읽겠어요' }], stop_reason: 'end_turn' },
    reply({ words: [W('creature', '생명체', ['crea', 'ture'])] }),
  ]);
  const r = await extractWordsFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'ok');
  assert.equal(r.calls, 2);
});

test('extractWordsFromImage: 두 번 다 깨지면 unparsable 로 끝낸다 (무한 재시도 없음)', async () => {
  const { callModel } = fakeModel([
    { content: [{ type: 'text', text: '???' }], stop_reason: 'end_turn' },
    { content: [{ type: 'text', text: '!!!' }], stop_reason: 'end_turn' },
  ]);
  const r = await extractWordsFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'unparsable');
  assert.equal(r.calls, 2);
  assert.deepEqual(r.words, []);
});

test('extractWordsFromImage: 거절이면 즉시 중단한다', async () => {
  const { callModel } = fakeModel([{ content: [], stop_reason: 'refusal' }]);
  const r = await extractWordsFromImage({ image: IMG, callModel });
  assert.equal(r.status, 'refused');
  assert.equal(r.calls, 1);
});

test('extractWordsFromImage: 모델 호출 오류는 그대로 던진다 (핸들러가 문구로 바꾼다)', async () => {
  const { callModel } = fakeModel([new Error('boom')]);
  await assert.rejects(extractWordsFromImage({ image: IMG, callModel }), /boom/);
});

test('extractPhonicsRules: 단어장에 있는 단어만 남긴 규칙을 돌려준다', async () => {
  const words = [W('creature', '생명체', ['crea', 'ture']), W('nature', '자연', ['na', 'ture'])];
  const { callModel, prompts } = fakeModel([
    reply({
      phonics: [
        { pattern: '-ture', sound: '처', tip: '끝의 ture 는 처', words: ['creature', 'nature', 'future'] },
      ],
    }),
  ]);
  const r = await extractPhonicsRules({ words, callModel });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.phonics[0].words, ['creature', 'nature']);
  assert.match(prompts[0], /단어: creature, nature/);
});

test('extractPhonicsRules: 응답이 이상해도 빈 배열로 끝난다', async () => {
  const { callModel } = fakeModel([{ content: [{ type: 'text', text: 'no' }], stop_reason: 'end_turn' }]);
  const r = await extractPhonicsRules({ words: [W('creature', '생명체', ['creature'])], callModel });
  assert.deepEqual(r.phonics, []);
});

test('extractStory: 약한 이야기(단어 2개 미만)면 한 번만 다시 묻는다', async () => {
  const words = [W('creature', '생명체', ['crea', 'ture']), W('vision', '시력', ['vi', 'sion']), W('insert', '넣다', ['in', 'sert'])];
  const { extractStory } = await import('./extract-service.mjs');
  const { callModel, prompts } = fakeModel([
    reply({ story: 'creature만 나오는 이야기' }),
    reply({ story: 'creature가 vision을 insert했어요.' }),
  ]);
  const r = await extractStory({ words, callModel });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.used, ['creature', 'vision', 'insert']);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /creature\(생명체\)/);
});

test('extractStory: 두 번 다 약하면 weak 로 끝내고, 거절이면 즉시 끝', async () => {
  const words = [W('creature', '생명체', ['crea', 'ture']), W('vision', '시력', ['vi', 'sion'])];
  const { extractStory } = await import('./extract-service.mjs');
  let m = fakeModel([reply({ story: '아무 단어도 없어요' }), reply({ story: '역시 없어요' })]);
  assert.equal((await extractStory({ words, callModel: m.callModel })).status, 'weak');
  m = fakeModel([{ content: [], stop_reason: 'refusal' }]);
  const r = await extractStory({ words, callModel: m.callModel });
  assert.equal(r.status, 'refused');
  assert.equal(m.prompts.length, 1);
});
