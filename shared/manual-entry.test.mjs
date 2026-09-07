import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWordLine, parseWordLines } from './manual-entry.mjs';

test('parseWordLine: 단어와 한글 뜻을 공백으로 나눈다', () => {
  assert.deepEqual(parseWordLine('creature 생명체'), { word: 'creature', meaning: '생명체', chunks: ['creature'] });
  assert.deepEqual(parseWordLine('vision   시력, 눈; 시야'), { word: 'vision', meaning: '시력, 눈; 시야', chunks: ['vision'] });
});

test('parseWordLine: 단어의 - 는 덩어리 경계, 띄어쓰기는 단어에 남는다', () => {
  assert.deepEqual(parseWordLine('crea-ture 생명체'), { word: 'creature', meaning: '생명체', chunks: ['crea', 'ture'] });
  assert.deepEqual(parseWordLine('co-ral reef, 산호초'), { word: 'coral reef', meaning: '산호초', chunks: ['co', 'ral reef'] });
  assert.deepEqual(parseWordLine('make up 화장하다').word, 'make up');
});

test('parseWordLine: 앞 번호, 구분자, 품사 표시를 뗀다', () => {
  assert.deepEqual(parseWordLine('03  brightly  ad. 밝게, 선명하게'), { word: 'brightly', meaning: '밝게, 선명하게', chunks: ['brightly'] });
  assert.deepEqual(parseWordLine('4) recognize: v. 인식하다'), { word: 'recognize', meaning: '인식하다', chunks: ['recognize'] });
  assert.deepEqual(parseWordLine('scissors\t가위'), { word: 'scissors', meaning: '가위', chunks: ['scissors'] });
  assert.deepEqual(parseWordLine('insert - 넣다'), { word: 'insert', meaning: '넣다', chunks: ['insert'] });
  assert.deepEqual(parseWordLine('make up 숙. 화장하다').meaning, '화장하다');
});

test('parseWordLine: 뜻이 없으면 빈 뜻으로 남기고, 영어가 없으면 null', () => {
  assert.deepEqual(parseWordLine('strength'), { word: 'strength', meaning: '', chunks: ['strength'] });
  assert.equal(parseWordLine('가위'), null);
  assert.equal(parseWordLine(''), null);
  assert.equal(parseWordLine('   '), null);
});

test('parseWordLine: 한글이 없는 줄은 탭·쉼표·콜론으로 나눈다', () => {
  assert.deepEqual(parseWordLine('apple, fruit'), { word: 'apple', meaning: 'fruit', chunks: ['apple'] });
  assert.deepEqual(parseWordLine('apple\tfruit').meaning, 'fruit');
});

test('parseWordLines: 여러 줄, 빈 줄 건너뛰기, CRLF', () => {
  const rows = parseWordLines('creature 생명체\r\n\r\n02 man-tis shrimp 갯가재\n가위만\nstrength 힘, 기운\n');
  assert.deepEqual(rows.map((r) => r.word), ['creature', 'mantis shrimp', 'strength']);
  assert.deepEqual(rows[1].chunks, ['man', 'tis shrimp']);
  assert.deepEqual(parseWordLines(null), []);
});
