import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidenceQuiz,
  gradeEvidence,
  buildReadingQuiz,
  gradeReading,
  summarizeReading,
  collectWrongQuestions,
} from './reading-quiz.mjs';

const SENTENCES = [
  'One of the most interesting creatures is the mantis shrimp.',
  'They are 15 to 30cm long and live around coral reefs in warm water.',
  'They are brightly colored and known for their amazing color vision and strength.',
  'Being able to see colors help animals find food and a mate.',
  'Humans can see only three groups of colors, red, blue, and green.',
];

const q = (over = {}) => ({
  type: 'detail',
  question: 'What helps animals find food?',
  options: ['being able to see colors', 'the number of groups', 'strength', 'thickness'],
  answer: 0,
  evidence: SENTENCES[3],
  evidenceIndex: 3,
  verified: true,
  ...over,
});

const QUESTIONS = [
  q(),
  q({ question: 'How long are they?', evidenceIndex: 1, evidence: SENTENCES[1], options: ['15 to 30cm', '1m', '2cm', '5m'] }),
  q({ type: 'main', question: 'What is this passage mainly about?', verified: false, evidenceIndex: -1, evidence: '' }),
];

/* ── 근거 문장 찾기 ────────────────────────────────────────────── */

test('buildEvidenceQuiz: 검증된 문제만 내고 보기에 정답 문장이 들어 있다', () => {
  const items = buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed: 5 });
  assert.equal(items.length, 2, '주제 문제는 제외된다');
  for (const it of items) {
    assert.equal(it.sentences.length, 4);
    assert.equal(it.sentences[it.answer], it.answerSentence);
    assert.ok(SENTENCES.includes(it.answerSentence));
    assert.equal(new Set(it.sentences).size, 4, '보기 문장이 겹치지 않는다');
    for (const s of it.sentences) assert.ok(SENTENCES.includes(s), '보기는 모두 지문 문장이어야 한다');
    assert.equal(SENTENCES[it.answerIndex], it.answerSentence, '번역을 찾을 수 있게 지문 안의 자리도 준다');
  }
});

test('buildEvidenceQuiz: 같은 시드는 같은 문제지, 다른 시드는 대개 다르다', () => {
  assert.deepEqual(buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed: 7 }), buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed: 7 }));
  const a = buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed: 1 });
  const b = buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed: 2 });
  assert.notDeepEqual(a, b);
});

test('buildEvidenceQuiz: 정답이 늘 같은 자리에 오지 않는다', () => {
  const spots = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    for (const it of buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed })) spots.add(it.answer);
  }
  assert.ok(spots.size >= 3, '정답 자리가 고정되면 아이가 자리를 외운다');
});

test('buildEvidenceQuiz: 문장이 모자라거나 쓸 문제가 없으면 빈 배열', () => {
  assert.deepEqual(buildEvidenceQuiz(['한 문장뿐'], QUESTIONS), []);
  assert.deepEqual(buildEvidenceQuiz(SENTENCES, [QUESTIONS[2]]), []);
  assert.deepEqual(buildEvidenceQuiz(null, null), []);
});

test('buildEvidenceQuiz: 지문 문장이 보기 수보다 적으면 있는 만큼만 낸다', () => {
  const two = SENTENCES.slice(0, 2);
  const items = buildEvidenceQuiz(two, [q({ evidenceIndex: 1, evidence: two[1] })], { seed: 3 });
  assert.equal(items[0].sentences.length, 2);
  assert.equal(items[0].sentences[items[0].answer], two[1]);
});

test('gradeEvidence: 고른 번호가 정답과 같아야 맞는다', () => {
  const item = buildEvidenceQuiz(SENTENCES, QUESTIONS, { seed: 9 })[0];
  assert.equal(gradeEvidence(item, item.answer).correct, true);
  assert.equal(gradeEvidence(item, (item.answer + 1) % 4).correct, false);
  assert.equal(gradeEvidence(item, item.answer).answerSentence, item.answerSentence);
});

/* ── 모의 시험 ─────────────────────────────────────────────────── */

test('buildReadingQuiz: 보기를 섞고 정답 번호를 다시 매긴다', () => {
  for (let seed = 1; seed <= 15; seed++) {
    for (const item of buildReadingQuiz(QUESTIONS, { seed })) {
      assert.equal(item.options[item.answer], item.answerText);
      const original = QUESTIONS.find((x) => x.question === item.question);
      assert.deepEqual([...item.options].sort(), [...original.options].sort(), '보기 내용은 그대로');
      assert.equal(item.answerText, original.options[original.answer], '정답 내용도 그대로');
    }
  }
});

test('buildReadingQuiz: 주제 문제도 시험에는 낸다 (근거 검증만 안 될 뿐)', () => {
  const items = buildReadingQuiz(QUESTIONS, { seed: 4 });
  assert.equal(items.length, 3);
  const main = items.find((i) => i.type === 'main');
  assert.equal(main.typeLabel, '주제');
  assert.equal(main.verified, false);
});

test('buildReadingQuiz: 같은 시드는 같은 문제지, 빈 입력은 빈 배열', () => {
  assert.deepEqual(buildReadingQuiz(QUESTIONS, { seed: 11 }), buildReadingQuiz(QUESTIONS, { seed: 11 }));
  assert.deepEqual(buildReadingQuiz([], { seed: 1 }), []);
  assert.deepEqual(buildReadingQuiz(null), []);
});

test('gradeReading: 정답 번호를 비교하고 정답 내용을 함께 준다', () => {
  const item = buildReadingQuiz(QUESTIONS, { seed: 6 })[0];
  assert.equal(gradeReading(item, item.answer).correct, true);
  assert.equal(gradeReading(item, item.answer).answerText, item.answerText);
  assert.equal(gradeReading(item, item.answer === 0 ? 1 : 0).correct, false);
});

/* ── 집계 ─────────────────────────────────────────────────────── */

test('summarizeReading: 점수와 유형별 성적을 낸다', () => {
  const s = summarizeReading([
    { type: 'detail', correct: true },
    { type: 'detail', correct: false },
    { type: 'main', correct: false },
    { type: 'blank', correct: true },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.correct, 2);
  assert.equal(s.percent, 50);
  assert.deepEqual(s.byType.detail, { total: 2, correct: 1 });
  assert.deepEqual(s.wrongTypes.sort(), ['detail', 'main']);
});

test('summarizeReading: 빈 결과에서 0으로 나누지 않는다', () => {
  const s = summarizeReading([]);
  assert.equal(s.percent, 0);
  assert.deepEqual(s.wrongTypes, []);
  assert.equal(summarizeReading(null).total, 0);
});

test('collectWrongQuestions: 틀린 문제만 원래 모양으로 추린다', () => {
  const wrong = collectWrongQuestions(QUESTIONS, [
    { question: 'What helps animals find food?', correct: false },
    { question: 'How long are they?', correct: true },
  ]);
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].question, 'What helps animals find food?');
  assert.equal(wrong[0].evidenceIndex, 3, '원래 문제 객체 그대로여야 다시 풀 수 있다');
  assert.deepEqual(collectWrongQuestions(null, null), []);
});
