import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wordsPrompt,
  phonicsPrompt,
  messageText,
  parseWordsResponse,
  parsePhonicsResponse,
  sanitizePhonics,
  normalizeLetters,
  wordMatchesLetters,
  highlightChunks,
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
  assert.match(p, /최대 5개/);
  assert.match(p, /억지로 채우지 말고/);
  assert.match(p, /letters/);
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

test('sanitizePhonics: 규칙 글자가 실제로 없는 단어는 뺀다 (모델이 억지로 채운 것)', () => {
  const words = [
    ...WORDS,
    { word: 'recognize', meaning: '알아보다', chunks: ['rec', 'og', 'nize'] },
    { word: 'hunter', meaning: '사냥꾼', chunks: ['hunt', 'er'] },
    { word: 'strength', meaning: '힘', chunks: ['strength'] },
  ];
  const out = sanitizePhonics(
    [
      { pattern: '-tion / -sion', letters: ['tion', 'sion'], sound: '션', tip: '', words: ['vision', 'recognize'] },
      { pattern: '-ng / -nth 같은 자음 뭉치', letters: ['ng', 'nth'], sound: '응', tip: '', words: ['strength', 'hunter'] },
      { pattern: '-ture', letters: ['ture'], sound: '처', tip: '', words: ['recognize'] },
    ],
    words
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].words, ['vision']);
  assert.deepEqual(out[0].letters, ['tion', 'sion']);
  assert.deepEqual(out[1].words, ['strength']);
});

test('sanitizePhonics: letters 가 없으면 pattern 에서 글자를 뽑아 대조한다 (예전 저장분 호환)', () => {
  const out = sanitizePhonics(
    [{ pattern: '-ture / -ing 앞의 t', sound: '처', tip: '', words: ['creature', 'vision'] }],
    WORDS
  );
  assert.deepEqual(out[0].letters, ['ture', 'ing']);
  assert.deepEqual(out[0].words, ['creature']);
});

test('normalizeLetters: 소문자·밑줄만 남기고 2글자 미만, 6글자 이상은 버린다', () => {
  assert.deepEqual(normalizeLetters(['TURE', 't', 'a_e', 'a_e', '-igh'], ''), ['ture', 'a_e', 'igh']);
  assert.deepEqual(normalizeLetters(['ng', 'fascinating'], ''), ['ng']);
  assert.deepEqual(normalizeLetters([], '매직 e (a_e)'), ['a_e']);
  assert.deepEqual(normalizeLetters([], '묵음 c'), []);
});

test('sanitizePhonics: 여러 소리를 묶은 규칙(블렌드)과 조각이 너무 많은 규칙은 버린다', () => {
  const words = [
    ...WORDS,
    { word: 'club', meaning: '막대기', chunks: ['club'] },
    { word: 'brightly', meaning: '밝게', chunks: ['bright', 'ly'] },
    { word: 'strength', meaning: '힘', chunks: ['strength'] },
    { word: 'mate', meaning: '친구', chunks: ['mate'] },
    { word: 'recognize', meaning: '알아보다', chunks: ['rec', 'og', 'nize'] },
  ];
  const out = sanitizePhonics(
    [
      { pattern: '자음 두 개 겹치기(블렌드)', letters: ['cr', 'cl', 'br', 'shr', 'str'], sound: '크르, 클, 브르, 슈르, 스트르', tip: '', words: ['creature', 'club', 'brightly', 'strength'] },
      { pattern: '매직 e', letters: ['a_e', 'i_e'], sound: '에이, 아이', tip: '', words: ['mate', 'recognize'] },
      { pattern: '자음 뭉치', letters: ['str', 'cl', 'br', 'cr'], sound: '스', tip: '', words: ['strength'] },
      { pattern: '매직 e (a_e)', letters: ['a_e'], sound: '에이', tip: '', words: ['mate', 'recognize'] },
      { pattern: 'ng', letters: ['ng', 'strength'], sound: '응', tip: '', words: ['strength', 'creature'] },
    ],
    words
  );
  assert.deepEqual(out.map((r) => r.pattern), ['매직 e (a_e)', 'ng']);
  assert.deepEqual(out[0].words, ['mate']);
  assert.deepEqual(out[1].letters, ['ng']);
  assert.deepEqual(out[1].words, ['strength']);
});

test('wordMatchesLetters: _ 는 자음 하나. 조각이 없으면 확인 불가로 통과', () => {
  assert.equal(wordMatchesLetters('mate', ['a_e']), true);
  assert.equal(wordMatchesLetters('recognize', ['a_e']), false);
  assert.equal(wordMatchesLetters('recognize', ['i_e']), true);
  assert.equal(wordMatchesLetters('coral reef', ['lr']), true);
  assert.equal(wordMatchesLetters('anything', []), true);
});

test('highlightChunks: 조각이 걸리는 글자와 겹치는 덩어리만 켠다', () => {
  assert.deepEqual(highlightChunks(['crea', 'ture'], ['ture']), [false, true]);
  assert.deepEqual(highlightChunks(['ma', 'te', 'ri', 'al'], ['ter']), [false, true, true, false]);
  assert.deepEqual(highlightChunks(['rec', 'og', 'nize'], ['tion', 'sion']), [false, false, false]);
  assert.deepEqual(highlightChunks(['bright', 'ly'], ['igh']), [true, false]);
  assert.deepEqual(highlightChunks(['mate'], []), [false]);
  assert.deepEqual(highlightChunks(null, ['a']), []);
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
  assert.deepEqual(PHONICS_SCHEMA.properties.phonics.items.required, ['pattern', 'letters', 'sound', 'tip', 'words']);
});

test('sanitizeMnemonics: 단어장 단어만, 빈 tip 은 버리고, 길이를 자른다', async () => {
  const { sanitizeMnemonics, MAX_MNEMONIC_CHARS } = await import('./extract-logic.mjs');
  const out = sanitizeMnemonics(
    [
      { word: 'Creature', tip: '  크리-처!   괴물이  처억 나타났어요 ' },
      { word: 'vision', tip: '' },
      { word: 'nothere', tip: '없는 단어' },
      { word: 'coral reef', tip: 'x'.repeat(200) },
    ],
    WORDS
  );
  assert.deepEqual(Object.keys(out), ['creature', 'coral reef']);
  assert.equal(out.creature, '크리-처! 괴물이 처억 나타났어요');
  assert.equal(out['coral reef'].length, MAX_MNEMONIC_CHARS);
  assert.deepEqual(sanitizeMnemonics(null, WORDS), {});
});

test('parsePhonicsResponse: mnemonics 도 함께 돌려주고, 없으면 빈 객체', () => {
  const r = parsePhonicsResponse(
    msg(JSON.stringify({ phonics: [], mnemonics: [{ word: 'vision', tip: '비전! 눈에 비친 전망' }] })),
    WORDS
  );
  assert.deepEqual(r.mnemonics, { vision: '비전! 눈에 비친 전망' });
  assert.deepEqual(parsePhonicsResponse(msg(JSON.stringify({ phonics: [] })), WORDS).mnemonics, {});
  assert.deepEqual(parsePhonicsResponse(null, WORDS).mnemonics, {});
});

test('storyPrompt: 단어와 뜻을 함께 넣고 한국어 이야기를 요구한다', async () => {
  const { storyPrompt } = await import('./extract-logic.mjs');
  const p = storyPrompt(WORDS);
  assert.match(p, /creature\(생명체\)/);
  assert.match(p, /한국어로/);
  assert.match(p, /철자 그대로/);
});

test('storyWordsUsed / splitStory: 이야기 속 영어 단어를 찾아 조각으로 나눈다', async () => {
  const { storyWordsUsed, splitStory } = await import('./extract-logic.mjs');
  const story = 'Coral reef에 사는 creature가 vision을 잃었어요. creatures는 세지 않아요.';
  assert.deepEqual(storyWordsUsed(story, WORDS), ['coral reef', 'creature', 'vision']);
  const parts = splitStory(story, WORDS);
  assert.deepEqual(parts.slice(0, 3), [
    { text: 'Coral reef', word: 'coral reef' },
    { text: '에 사는 ' },
    { text: 'creature', word: 'creature' },
  ]);
  assert.equal(parts.filter((p) => p.word).length, 3, 'creatures 는 단어 경계가 아니므로 칩이 아니다');
  assert.equal(parts.map((p) => p.text).join(''), story);
  assert.deepEqual(splitStory('', WORDS), []);
  assert.deepEqual(splitStory('그냥 글', []), [{ text: '그냥 글' }]);
});

test('parseStoryResponse: 단어가 2개 이상 들어가면 ok, 아니면 weak, 마크다운은 벗긴다', async () => {
  const { parseStoryResponse, MAX_STORY_CHARS } = await import('./extract-logic.mjs');
  const ok = parseStoryResponse(msg(JSON.stringify({ story: '**creature**가 vision을 얻었어요.' })), WORDS);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.story, 'creature가 vision을 얻었어요.');
  assert.deepEqual(ok.used, ['creature', 'vision']);

  assert.equal(parseStoryResponse(msg(JSON.stringify({ story: 'creature만 나와요.' })), WORDS).status, 'weak');
  assert.equal(parseStoryResponse(msg(JSON.stringify({ story: 'creature vision ' + 'x'.repeat(MAX_STORY_CHARS) })), WORDS).status, 'weak');
  assert.equal(parseStoryResponse(msg('???'), WORDS).status, 'unparsable');
  assert.equal(parseStoryResponse({ content: [], stop_reason: 'refusal' }, WORDS).status, 'refused');
});
