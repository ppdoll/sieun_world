import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wordsPrompt,
  phonicsPrompt,
  messageText,
  parseWordsResponse,
  parsePhonicsResponse,
  sanitizePhonics,
  mergeWords,
  flagWords,
  WORDS_SCHEMA,
  PHONICS_SCHEMA,
} from './extract-logic.mjs';

const WORDS = [
  { word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] },
  { word: 'vision', meaning: '시력, 눈', chunks: ['vi', 'sion'] },
  { word: 'coral reef', meaning: '산호초', chunks: ['co', 'ral', 'reef'] },
];

const msg = (text, stop_reason = 'end_turn') => ({
  content: [{ type: 'text', text }],
  stop_reason,
});

test('wordsPrompt: 상/하반부 요청은 첫 줄만 다르고 형식 지시는 같다', () => {
  const all = wordsPrompt('all');
  const top = wordsPrompt('top');
  const bottom = wordsPrompt('bottom');
  assert.match(top, /위쪽 절반/);
  assert.match(bottom, /아래쪽 절반/);
  assert.equal(all.split('\n').slice(1).join('\n'), top.split('\n').slice(1).join('\n'));
  assert.equal(wordsPrompt('nonsense'), all);
});

test('phonicsPrompt: 단어 목록을 쉼표로 이어 넣는다', () => {
  const p = phonicsPrompt(WORDS);
  assert.match(p, /creature, vision, coral reef/);
  assert.match(p, /정확히 5개/);
});

test('messageText: text 블록만 이어붙이고 나머지는 무시한다', () => {
  const m = {
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: '{"a":' },
      { type: 'text', text: '1}' },
    ],
  };
  assert.equal(messageText(m), '{"a":\n1}');
  assert.equal(messageText(null), '');
});

test('parseWordsResponse: 정상 응답은 ok 와 정리된 단어', () => {
  const r = parseWordsResponse(msg(JSON.stringify({ words: WORDS })));
  assert.equal(r.status, 'ok');
  assert.equal(r.words.length, 3);
  assert.deepEqual(r.words[0].chunks, ['crea', 'ture']);
});

test('parseWordsResponse: max_tokens 로 잘리면 truncated', () => {
  const r = parseWordsResponse(msg('{"words":[{"word":"crea', 'max_tokens'));
  assert.equal(r.status, 'truncated');
  assert.deepEqual(r.words, []);
});

test('parseWordsResponse: 잘렸지만 JSON 이 닫혀 있으면 건진 단어를 함께 돌려준다', () => {
  const r = parseWordsResponse(msg(JSON.stringify({ words: WORDS.slice(0, 1) }), 'max_tokens'));
  assert.equal(r.status, 'truncated');
  assert.equal(r.words.length, 1);
});

test('parseWordsResponse: refusal 은 refused', () => {
  const r = parseWordsResponse({ content: [], stop_reason: 'refusal' });
  assert.equal(r.status, 'refused');
});

test('parseWordsResponse: JSON 을 복구할 수 없으면 unparsable', () => {
  assert.equal(parseWordsResponse(msg('죄송하지만 사진이 흐려요')).status, 'unparsable');
  assert.equal(parseWordsResponse(undefined).status, 'unparsable');
});

test('parseWordsResponse: 마크다운 펜스와 잡문이 붙어도 복구한다', () => {
  const text = '네, 결과입니다.\n```json\n' + JSON.stringify({ words: WORDS }) + '\n```\n끝.';
  const r = parseWordsResponse(msg(text));
  assert.equal(r.status, 'ok');
  assert.equal(r.words.length, 3);
});

test('parseWordsResponse: 뜻이 빈 단어는 버리지 않고 남긴다 (검수 화면에서 표시)', () => {
  const r = parseWordsResponse(
    msg(JSON.stringify({ words: [{ word: 'insert', meaning: '', chunks: ['in', 'sert'] }] }))
  );
  assert.equal(r.status, 'ok');
  assert.equal(r.words.length, 1);
  assert.equal(r.words[0].meaning, '');
});

test('parseWordsResponse: 철자가 안 맞는 chunks 는 통째로 되돌린다', () => {
  const r = parseWordsResponse(
    msg(JSON.stringify({ words: [{ word: 'creature', meaning: '생명체', chunks: ['crea', 'tur'] }] }))
  );
  assert.deepEqual(r.words[0].chunks, ['creature']);
});

test('sanitizePhonics: 단어장에 없는 단어는 빼고 철자를 단어장 기준으로 맞춘다', () => {
  const out = sanitizePhonics(
    [
      { pattern: '-ture', sound: '처', tip: '처 소리', words: ['Creature', 'nature', 'creature'] },
      { pattern: '-sion', sound: '전', tip: '', words: ['vision'] },
    ],
    WORDS
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].words, ['creature']);
  assert.equal(out[1].tip, '');
});

test('sanitizePhonics: pattern/sound 가 비거나 해당 단어가 없는 규칙은 버린다', () => {
  const out = sanitizePhonics(
    [
      { pattern: '', sound: '처', words: ['creature'] },
      { pattern: 'igh', sound: '아이', words: ['night'] },
      { pattern: 'x', words: ['vision'] },
    ],
    WORDS
  );
  assert.deepEqual(out, []);
  assert.deepEqual(sanitizePhonics('nope', WORDS), []);
});

test('sanitizePhonics: 최대 5개', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    pattern: 'p' + i,
    sound: 's',
    tip: '',
    words: ['vision'],
  }));
  assert.equal(sanitizePhonics(many, WORDS).length, 5);
});

test('parsePhonicsResponse: 실패해도 항상 phonics 배열을 돌려준다', () => {
  assert.deepEqual(parsePhonicsResponse(null, WORDS).phonics, []);
  assert.deepEqual(parsePhonicsResponse(msg('말도 안 되는 답'), WORDS).phonics, []);
  const ok = parsePhonicsResponse(
    msg(JSON.stringify({ phonics: [{ pattern: '-ture', sound: '처', tip: 't', words: ['creature'] }] })),
    WORDS
  );
  assert.equal(ok.status, 'ok');
  assert.equal(ok.phonics.length, 1);
});

test('mergeWords: 여러 번의 결과를 합치면서 중복은 먼저 온 것을 남긴다', () => {
  const merged = mergeWords(
    [{ word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] }],
    [{ word: 'Creature', meaning: '괴물', chunks: ['creature'] }, WORDS[1]],
    [WORDS[2]]
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[0].meaning, '생명체');
});

test('flagWords: 뜻이 비었거나 한 글자면 표시한다', () => {
  const flags = flagWords([
    { word: 'coral', meaning: '', chunks: ['co', 'ral'] },
    { word: 'insert', meaning: '넣', chunks: ['in', 'sert'] },
  ]);
  assert.deepEqual(flags[0], ['empty-meaning']);
  assert.deepEqual(flags[1], ['short-meaning']);
});

test('flagWords: 같은 뜻이 두 단어에 붙으면 둘 다 표시한다', () => {
  const flags = flagWords([
    { word: 'big', meaning: '큰', chunks: ['big'] },
    { word: 'large', meaning: '큰', chunks: ['large'] },
    { word: 'small', meaning: '작은', chunks: ['small'] },
  ]);
  assert.ok(flags[0].includes('dup-meaning'));
  assert.ok(flags[1].includes('dup-meaning'));
  assert.ok(!flags[2].includes('dup-meaning'));
});

test('flagWords: 긴 단어가 한 덩어리면 fallback, 이어붙여 안 맞으면 mismatch', () => {
  const flags = flagWords([
    { word: 'fascinating', meaning: '매력적인', chunks: ['fascinating'] },
    { word: 'creature', meaning: '생명체', chunks: ['crea', 'tur'] },
    { word: 'cat', meaning: '고양이', chunks: ['cat'] },
  ]);
  assert.deepEqual(flags[0], ['chunk-fallback']);
  assert.deepEqual(flags[1], ['chunk-mismatch']);
  assert.deepEqual(flags[2], []);
});

test('flagWords: 입력이 배열이 아니면 빈 배열', () => {
  assert.deepEqual(flagWords(null), []);
});

test('스키마: words / phonics 가 필수이고 추가 속성은 막는다', () => {
  assert.deepEqual(WORDS_SCHEMA.required, ['words']);
  assert.equal(WORDS_SCHEMA.additionalProperties, false);
  assert.deepEqual(PHONICS_SCHEMA.properties.phonics.items.required, ['pattern', 'sound', 'tip', 'words']);
});
