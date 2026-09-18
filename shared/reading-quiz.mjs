// shared/reading-quiz.mjs
// 독해 연습의 문제지 생성과 채점. 순수 함수이고 난수는 시드를 받는다.
//
// 두 가지를 만든다.
//   1. 근거 문장 찾기 — 질문을 주고 답이 있는 지문 문장을 고르게 한다 (아이가 실제로 약한 지점)
//   2. 모의 시험 — 시험과 같은 4지선다. 보기를 섞어 정답 자리를 고정하지 않는다

import { makeRng, shuffle } from './wordlab-logic.mjs';
import { QUESTION_TYPES } from './passage-logic.mjs';

export const EVIDENCE_CHOICES = 4;

/**
 * 근거 문장 찾기 문제지.
 * 근거가 검증된 문제만 낸다 (주제·의도는 한 문장으로 짚을 수 없어 제외).
 * 오답 보기는 같은 지문의 다른 문장에서 뽑아 "지문에서 찾는" 연습이 되게 한다.
 *
 * @returns {Array<{question, type, sentences: string[], answer: number, answerSentence: string}>}
 */
export function buildEvidenceQuiz(sentences, questions, { seed = 1, choices = EVIDENCE_CHOICES } = {}) {
  const list = Array.isArray(sentences) ? sentences : [];
  const usable = (Array.isArray(questions) ? questions : []).filter(
    (q) => q && q.verified && q.evidenceIndex >= 0 && q.evidenceIndex < list.length
  );
  if (list.length < 2 || usable.length === 0) return [];

  const rng = makeRng(seed);
  return shuffle(usable, rng).map((q) => {
    const answerSentence = list[q.evidenceIndex];
    const pool = list.filter((_, i) => i !== q.evidenceIndex);
    const distractors = shuffle(pool, rng).slice(0, Math.max(0, Math.min(choices, list.length) - 1));
    const options = shuffle([answerSentence, ...distractors], rng);
    return {
      question: q.question,
      type: q.type,
      sentences: options,
      answer: options.indexOf(answerSentence),
      answerSentence,
    };
  });
}

/** 근거 찾기 채점 */
export function gradeEvidence(item, pickedIndex) {
  const correct = Number(pickedIndex) === item?.answer;
  return { correct, answerSentence: item?.answerSentence ?? '' };
}

/**
 * 모의 시험 문제지. 보기를 섞고 정답 번호를 다시 매긴다.
 * 같은 seed 면 같은 문제지가 나온다.
 */
export function buildReadingQuiz(questions, { seed = 1 } = {}) {
  const list = (Array.isArray(questions) ? questions : []).filter(
    (q) => q && Array.isArray(q.options) && q.options.length > 0
  );
  if (list.length === 0) return [];
  const rng = makeRng(seed);
  return shuffle(list, rng).map((q) => {
    const answerText = q.options[q.answer];
    const options = shuffle(q.options, rng);
    return {
      type: q.type,
      typeLabel: QUESTION_TYPES[q.type] ?? '세부',
      question: q.question,
      options,
      answer: options.indexOf(answerText),
      answerText,
      evidence: q.evidence ?? '',
      verified: !!q.verified,
    };
  });
}

/** 모의 시험 채점 */
export function gradeReading(item, pickedIndex) {
  return { correct: Number(pickedIndex) === item?.answer, answerText: item?.answerText ?? '' };
}

/** 집계. 유형별로 몇 개 틀렸는지 함께 낸다 (약한 유형을 부모가 본다) */
export function summarizeReading(results) {
  const list = Array.isArray(results) ? results : [];
  const total = list.length;
  const correct = list.filter((r) => r.correct).length;
  const byType = {};
  for (const r of list) {
    const key = r.type ?? 'detail';
    byType[key] ??= { total: 0, correct: 0 };
    byType[key].total++;
    if (r.correct) byType[key].correct++;
  }
  return {
    total,
    correct,
    percent: total === 0 ? 0 : Math.round((correct / total) * 100),
    byType,
    wrongTypes: Object.entries(byType)
      .filter(([, v]) => v.correct < v.total)
      .map(([k]) => k),
  };
}

/** 틀린 문제만 추린다 (오답 복습용) */
export function collectWrongQuestions(questions, results) {
  const wrong = new Set(list(results).filter((r) => !r.correct).map((r) => r.question));
  return list(questions).filter((q) => wrong.has(q.question));
}

function list(x) {
  return Array.isArray(x) ? x : [];
}
