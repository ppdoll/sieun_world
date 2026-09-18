import { useState, useEffect, useRef } from 'react';
import {
  QUESTION_TYPES,
  cleanPassage,
  splitSentences,
  sanitizeQuestions,
  flagQuestions,
  mergeQuestions,
  buildWordIndex,
  splitSentenceByWords,
} from '../shared/passage-logic.mjs';
import {
  buildEvidenceQuiz,
  gradeEvidence,
  buildReadingQuiz,
  gradeReading,
  summarizeReading,
  collectWrongQuestions,
} from '../shared/reading-quiz.mjs';
import { makePassageSet, passageSetTitle, verifiedCount, MAX_PASSAGE_SETS } from '../shared/passagesets.mjs';
import { addWordSet, removeWordSet, updateWordSet, findWordSet, markStudied, sortByActivity } from '../shared/wordsets.mjs';
import { speak, initSpeech } from './speech.js';
import { SpeakBtn, Steps } from './ui.jsx';
import { prepareImage, extractPassage, makeQuestions, getPasscode, setPasscode } from './api.js';
import { loadPassageSets, savePassageSets, loadWordSets } from './storage.js';

const READ_STEPS = [
  { key: 'upload', label: '지문' },
  { key: 'read', label: '읽기' },
  { key: 'evidence', label: '근거' },
  { key: 'quiz', label: '시험' },
];
const STEP_INDEX = { upload: 0, check: 0, read: 1, evidence: 2, quiz: 3, result: 3 };

/* ────────────────────────────────────────────────────────────
   1. 지문 사진 올리기
   ──────────────────────────────────────────────────────────── */

function Upload({ onExtracted, sets, onResume, onRemove }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [needPasscode, setNeedPasscode] = useState(false);
  const [code, setCode] = useState(getPasscode());
  const inputRef = useRef(null);

  async function run() {
    setBusy(true);
    setErr('');
    try {
      const all = [];
      let title = '';
      let cut = false;
      for (let i = 0; i < files.length; i++) {
        setNote(files.length + '장 중 ' + (i + 1) + '번째 사진을 읽는 중');
        const image = await prepareImage(files[i]);
        const got = await extractPassage(image);
        all.push(got);
        if (!title && got.title) title = got.title;
        if (got.status === 'truncated') cut = true;
      }
      const passage = cleanPassage(all.map((g) => g.passage).filter(Boolean).join('\n\n'));
      if (!passage) throw new Error('지문을 찾지 못했어요. 글자가 잘 보이게 다시 찍어주세요.');
      const sentences = splitSentences(passage);
      // 사진마다 따로 검증됐으니 합친 지문 기준으로 한 번 더 맞춘다
      const { questions } = sanitizeQuestions(mergeQuestions(...all.map((g) => g.questions || [])), sentences);
      setNeedPasscode(false);
      onExtracted({ title, passage, sentences, questions, truncated: cut });
    } catch (e) {
      if (e.needPasscode) setNeedPasscode(true);
      setErr(e.message || '잘 되지 않았어요. 한 번 더 눌러주세요.');
    } finally {
      setBusy(false);
      setNote('');
    }
  }

  return (
    <div className="wl-pane">
      <h1 className="wl-h1">
        지문 사진을 올리면
        <br />
        읽기 연습이 만들어져요
      </h1>
      <p className="wl-sub">지문을 문장으로 나눠 읽고, 답이 어느 문장에 있는지 찾는 연습을 한 다음 모의 시험을 봅니다.</p>

      <div className="wl-drop" onClick={() => !busy && inputRef.current?.click()}>
        <div className="wl-drop-ico">📖</div>
        <div className="wl-drop-t">{files.length ? files.length + '장 선택함' : '지문 사진 고르기'}</div>
        <div className="wl-drop-s">지문이 있는 쪽을 찍어요. 문제가 함께 찍히면 그 문제도 같이 씁니다.</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            setFiles([...e.target.files]);
            setErr('');
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="wl-filelist">
          {files.map((f, i) => (
            <li key={i}>{f.name}</li>
          ))}
        </ul>
      )}

      {needPasscode && (
        <div className="wl-passbox">
          <label className="wl-passlabel" htmlFor="wl-pass-read">
            비밀번호를 넣어주세요. 아빠가 알고 있어요.
          </label>
          <input
            id="wl-pass-read"
            className="wl-passinput"
            type="password"
            inputMode="numeric"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setPasscode(e.target.value);
            }}
          />
        </div>
      )}

      {err && <div className="wl-err">{err}</div>}

      <button className="wl-cta" disabled={!files.length || busy} onClick={run}>
        {busy ? note || '읽는 중' : '지문 뽑기'}
      </button>

      {busy && (
        <div className="wl-bar">
          <span />
        </div>
      )}

      {!busy && <p className="wl-note">지문은 이 기기(브라우저)에 저장돼요.</p>}

      {sets.length > 0 && !busy && (
        <div className="wl-sets">
          <div className="wl-sets-h">
            <span>
              지난 지문 <span className="wl-sets-n">{sets.length} / {MAX_PASSAGE_SETS}</span>
            </span>
          </div>
          {sets.map((s) => (
            <div className="wl-set" key={s.id}>
              <button className="wl-set-main" onClick={() => onResume(s.id)}>
                <span className="wl-set-text">
                  <span className="wl-set-t">{passageSetTitle(s)}</span>
                  <span className="wl-set-s">
                    문장 {s.sentences.length}개 · 문제 {s.questions.length}개
                    {s.lastStudiedAt ? ' · 이 기기에서 공부함' : ''}
                  </span>
                </span>
              </button>
              <button className="wl-x" onClick={() => onRemove(s.id)} aria-label="이 지문 지우기">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   2. 검수 — 저장 전에 부모가 지문과 문제를 확인한다
   ──────────────────────────────────────────────────────────── */

const FLAG_LABEL = {
  unverified: '근거 문장을 지문에서 확인하지 못했어요',
  'long-option': '보기가 너무 길어요',
};

function Review({ pending, loading, onConfirm, onBack }) {
  const [passage, setPassage] = useState(pending.passage);
  const [questions, setQuestions] = useState(pending.questions);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPassage(pending.passage);
    setQuestions(pending.questions);
  }, [pending]);

  const sentences = splitSentences(passage);
  const flags = flagQuestions(questions);
  const flagged = flags.filter((f) => f.length).length;

  function setAnswer(qi, oi) {
    setQuestions((qs) => qs.map((q, i) => (i === qi ? { ...q, answer: oi } : q)));
  }
  function removeQuestion(qi) {
    setQuestions((qs) => qs.filter((_, i) => i !== qi));
  }

  return (
    <div className="wl-pane">
      <h2 className="wl-h2">지문과 문제를 확인해 주세요</h2>
      <p className="wl-sub">
        지문이 잘못 읽혔으면 고쳐주세요. 문제는 정답을 눌러 바꾸거나 지울 수 있어요.
      </p>
      {pending.truncated && (
        <div className="wl-err">지문이 길어 일부를 놓쳤을 수 있어요. 아래 글이 교재와 같은지 봐주세요.</div>
      )}
      {flagged > 0 && <div className="wl-warn">노란 문제 {flagged}개는 정답이 맞는지 한 번 더 봐주세요.</div>}

      <div className="wl-review-head">
        <span className="wl-review-t">지문 · 문장 {sentences.length}개</span>
        <button className="wl-link" onClick={() => setEditing((v) => !v)}>
          {editing ? '보기' : '고치기'}
        </button>
      </div>
      {editing ? (
        <textarea className="wl-paste" rows={10} value={passage} onChange={(e) => setPassage(e.target.value)} spellCheck={false} />
      ) : (
        <div className="wl-passagebox">
          {sentences.map((s, i) => (
            <p className="wl-psent" key={i}>
              <span className="wl-psent-n">{i + 1}</span>
              {s}
            </p>
          ))}
        </div>
      )}

      <div className="wl-review-head">
        <span className="wl-review-t">문제 {questions.length}개</span>
        {loading && <span className="wl-set-s">문제를 더 만드는 중…</span>}
      </div>
      {loading && (
        <div className="wl-bar">
          <span />
        </div>
      )}

      {questions.map((q, qi) => (
        <div className={'wl-qcard' + (flags[qi].length ? ' flagged' : '')} key={qi}>
          <div className="wl-qhead">
            <span className="wl-badge">{QUESTION_TYPES[q.type]}</span>
            <button className="wl-x" onClick={() => removeQuestion(qi)} aria-label="이 문제 지우기">
              ×
            </button>
          </div>
          <div className="wl-qtext">{q.question}</div>
          <div className="wl-qopts">
            {q.options.map((o, oi) => (
              <button
                key={oi}
                className={'wl-qopt' + (oi === q.answer ? ' on' : '')}
                onClick={() => setAnswer(qi, oi)}
              >
                {o}
              </button>
            ))}
          </div>
          {q.evidence && <div className="wl-qev">근거: {q.evidence}</div>}
          {flags[qi].length > 0 && <div className="wl-flags">{flags[qi].map((f) => FLAG_LABEL[f]).join(' · ')}</div>}
        </div>
      ))}

      {questions.length === 0 && !loading && (
        <div className="wl-err">쓸 수 있는 문제가 없어요. 지문만으로 읽기 연습은 할 수 있어요.</div>
      )}

      <p className="wl-note">시작을 누르면 이 지문이 이 기기에 저장돼요.</p>
      <div className="wl-row">
        <button className="wl-ghost" onClick={onBack}>
          사진 다시 고르기
        </button>
        <button
          className="wl-cta wl-inline"
          disabled={sentences.length === 0}
          onClick={() => onConfirm({ ...pending, passage: cleanPassage(passage), sentences, questions })}
        >
          이대로 시작
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   3. 지문 읽기 — 문장 하나씩. 이미 외운 단어에는 뜻을 단다
   ──────────────────────────────────────────────────────────── */

function Read({ sentences, wordIndex, onNext }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(null); // 뜻을 펼친 단어
  const sentence = sentences[i] ?? '';
  const last = i === sentences.length - 1;
  const parts = splitSentenceByWords(sentence, wordIndex);
  const known = parts.filter((p) => p.word).length;

  useEffect(() => {
    setShown(null);
    speak(sentence);
  }, [i]); // eslint-disable-line

  return (
    <div className="wl-pane">
      <div className="wl-count">
        {i + 1} / {sentences.length}
      </div>
      <p className="wl-sub">
        한 문장씩 소리로 들으며 읽어요.{known > 0 ? ' 밑줄 친 단어는 외운 단어예요. 누르면 뜻이 보여요.' : ''}
      </p>

      <div className="wl-stage">
        <p className="wl-sentence">
          {parts.map((p, k) =>
            p.word ? (
              <button key={k} className="wl-known" onClick={() => setShown(shown === k ? null : k)}>
                {p.text}
                {shown === k && <span className="wl-known-tip">{p.meaning}</span>}
              </button>
            ) : (
              <span key={k}>{p.text}</span>
            )
          )}
        </p>
        <div className="wl-row wl-center">
          <SpeakBtn text={sentence} label="듣기" big />
          <SpeakBtn text={sentence} label="천천히" rate={0.5} big />
        </div>
      </div>

      <div className="wl-row">
        <button className="wl-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          이전
        </button>
        {last ? (
          <button className="wl-cta wl-inline" onClick={onNext}>
            근거 찾기 연습
          </button>
        ) : (
          <button className="wl-cta wl-inline" onClick={() => setI(i + 1)}>
            다음
          </button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   4. 근거 문장 찾기 — 질문의 답이 어느 문장에 있는지 고른다
   ──────────────────────────────────────────────────────────── */

function Evidence({ sentences, questions, seed, onNext }) {
  const [items] = useState(() => buildEvidenceQuiz(sentences, questions, { seed }));
  const [i, setI] = useState(0);
  const [judged, setJudged] = useState(null);
  const item = items[i];
  const last = i === items.length - 1;

  if (!item) {
    return (
      <div className="wl-pane">
        <h2 className="wl-h2">근거 문장 찾기</h2>
        <div className="wl-err">근거를 확인한 문제가 없어서 이 연습은 건너뛸게요.</div>
        <button className="wl-cta" onClick={onNext}>
          시험 보러 가기
        </button>
      </div>
    );
  }

  function pick(k) {
    if (judged) return;
    const g = gradeEvidence(item, k);
    setJudged({ ...g, picked: k });
    speak(item.answerSentence);
  }
  function next() {
    if (last) return onNext();
    setJudged(null);
    setI(i + 1);
  }

  return (
    <div className="wl-pane">
      <div className="wl-quizhead">
        <span className="wl-badge">근거 문장 찾기</span>
        <span className="wl-count">
          {i + 1} / {items.length}
        </span>
      </div>
      <div className="wl-progress">
        <span style={{ width: (i / items.length) * 100 + '%' }} />
      </div>
      <p className="wl-sub">이 질문의 답이 어느 문장에 있을까요. 문장을 골라주세요.</p>

      <div className="wl-stage wl-stage-left">
        <div className="wl-qtext wl-qtext-big">{item.question}</div>
        <div className="wl-options">
          {item.sentences.map((s, k) => (
            <button
              key={k}
              className={
                'wl-opt wl-opt-sent' +
                (judged && k === item.answer ? ' ok' : '') +
                (judged && k === judged.picked && !judged.correct ? ' no' : '') +
                (judged && k !== item.answer && k !== judged.picked ? ' dim' : '')
              }
              disabled={!!judged}
              onClick={() => pick(k)}
            >
              {s}
            </button>
          ))}
        </div>

        {judged && (
          <div className={'wl-verdict ' + (judged.correct ? 'ok' : 'no')}>
            <div className="wl-verdict-t">{judged.correct ? '맞았어요' : '답이 있는 문장은 이거예요'}</div>
            {!judged.correct && <p className="wl-note">고른 문장에는 이 질문의 답이 없어요. 초록색 문장을 다시 읽어볼까요.</p>}
            <div className="wl-row wl-center">
              <SpeakBtn text={item.answerSentence} label="문장 듣기" />
            </div>
            <button className="wl-cta" onClick={next}>
              {last ? '시험 보러 가기' : '다음'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   5. 모의 시험 — 실제 시험과 같은 여섯 유형
   ──────────────────────────────────────────────────────────── */

function Quiz({ questions, seed, title, subtitle, onDone }) {
  const [quiz] = useState(() => buildReadingQuiz(questions, { seed }));
  const [i, setI] = useState(0);
  const [judged, setJudged] = useState(null);
  const [results, setResults] = useState([]);
  const item = quiz[i];

  if (!item) return null;

  function pick(k) {
    if (judged) return;
    const g = gradeReading(item, k);
    setJudged({ ...g, picked: k });
    setResults((r) => [...r, { question: item.question, type: item.type, correct: g.correct }]);
  }
  function next() {
    if (i === quiz.length - 1) return onDone(results);
    setJudged(null);
    setI(i + 1);
  }

  return (
    <div className="wl-pane">
      <div className="wl-quizhead">
        <span className="wl-badge">{item.typeLabel}</span>
        <span className="wl-count">
          {i + 1} / {quiz.length}
        </span>
      </div>
      <div className="wl-progress">
        <span style={{ width: (i / quiz.length) * 100 + '%' }} />
      </div>
      <h2 className="wl-h2 wl-h2-tight">{title}</h2>
      {subtitle && <p className="wl-sub">{subtitle}</p>}

      <div className="wl-stage wl-stage-left">
        <div className="wl-qtext wl-qtext-big">{item.question}</div>
        <div className="wl-options">
          {item.options.map((o, k) => (
            <button
              key={k}
              className={
                'wl-opt' +
                (judged && k === item.answer ? ' ok' : '') +
                (judged && k === judged.picked && !judged.correct ? ' no' : '') +
                (judged && k !== item.answer && k !== judged.picked ? ' dim' : '')
              }
              disabled={!!judged}
              onClick={() => pick(k)}
            >
              {o}
            </button>
          ))}
        </div>

        {judged && (
          <div className={'wl-verdict ' + (judged.correct ? 'ok' : 'no')}>
            <div className="wl-verdict-t">{judged.correct ? '맞았어요' : '정답을 볼까요'}</div>
            {item.evidence ? (
              <>
                <p className="wl-note">지문에서 답이 있는 곳이에요.</p>
                <div className="wl-qev wl-qev-big">{item.evidence}</div>
                <div className="wl-row wl-center">
                  <SpeakBtn text={item.evidence} label="문장 듣기" />
                </div>
              </>
            ) : (
              <p className="wl-note">이 문제는 글 전체를 보고 고르는 문제예요.</p>
            )}
            <button className="wl-cta" onClick={next}>
              {i === quiz.length - 1 ? '결과 보기' : '다음'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Result({ summary, mode, wrongCount, onNext, onRetry }) {
  const good = summary.percent >= 80;
  return (
    <div className="wl-pane">
      <div className="wl-score">
        <span className="wl-score-n">{summary.correct}</span>
        <span className="wl-score-d">/ {summary.total}</span>
      </div>
      <h2 className="wl-h2 wl-center-t">{good ? '잘했어요' : summary.correct > 0 ? '여기까지 왔어요' : '이제 시작이에요'}</h2>

      {summary.wrongTypes.length > 0 && (
        <div className="wl-types">
          {Object.entries(summary.byType).map(([k, v]) => (
            <div className={'wl-type' + (v.correct < v.total ? ' weak' : '')} key={k}>
              <span className="wl-type-l">{QUESTION_TYPES[k] ?? k}</span>
              <span className="wl-type-n">
                {v.correct} / {v.total}
              </span>
            </div>
          ))}
        </div>
      )}

      {wrongCount > 0 ? (
        <>
          <p className="wl-sub">다시 볼 문제 {wrongCount}개예요. 맞힌 건 넘어가고 이것만 돌릴게요.</p>
          <button className="wl-cta" onClick={onNext}>
            틀린 것만 다시 풀기
          </button>
        </>
      ) : (
        <>
          <p className="wl-sub">전부 맞혔어요.</p>
          <button className="wl-cta" onClick={onNext}>
            처음으로
          </button>
        </>
      )}
      <button className="wl-ghost" onClick={onRetry}>
        {mode === 'review' ? '오답 다시 풀기' : '시험 다시 풀기'}
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   앱
   ──────────────────────────────────────────────────────────── */

export default function Reading({ onHome }) {
  const [step, setStep] = useState('upload');
  const [pending, setPending] = useState({ title: '', passage: '', sentences: [], questions: [], truncated: false });
  const [sets, setSets] = useState([]);
  const setsRef = useRef([]);
  const [wordIndex, setWordIndex] = useState(() => new Map());
  const [currentId, setCurrentId] = useState(null);
  const [passage, setPassage] = useState('');
  const [sentences, setSentences] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [quizQuestions, setQuizQuestions] = useState([]); // 지금 푸는 문제 (오답만 남을 수 있다)
  const [summary, setSummary] = useState(null);
  const [mode, setMode] = useState('quiz');
  const [wrong, setWrong] = useState([]);
  const [seedBump, setSeedBump] = useState(0);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    commitSets(loadPassageSets());
    setWordIndex(buildWordIndex(loadWordSets()));
    initSpeech();
  }, []);

  function commitSets(next) {
    const sorted = sortByActivity(next);
    setsRef.current = sorted;
    setSets(sorted);
    savePassageSets(sorted);
  }

  /** 지문에서 모의 문제를 만들어 붙인다. 사진은 다시 읽지 않는다 */
  async function loadQuestions(text, existing, id) {
    setGenLoading(true);
    setGenError('');
    try {
      const got = await makeQuestions(text, existing.map((q) => q.question));
      const merged = mergeQuestions(existing, got.questions || []);
      setQuestions(merged);
      setPending((p) => ({ ...p, questions: merged }));
      if (id) commitSets(updateWordSet(setsRef.current, id, { questions: merged }));
      if ((got.questions || []).length === 0) {
        setGenError('새 문제를 만들지 못했어요. 지금 있는 문제로 연습해도 괜찮아요.');
      }
    } catch (e) {
      setGenError(e.message || '새 문제를 만들지 못했어요. 지금 있는 문제로 연습해도 괜찮아요.');
    } finally {
      setGenLoading(false);
    }
  }

  function onExtracted(got) {
    setPending(got);
    setStep('check');
    // 검수 화면을 보는 동안 모의 문제를 만들어 둔다
    loadQuestions(got.passage, got.questions, null);
  }

  /** 검수를 마친 지문으로 시작 */
  function start(checked) {
    const set = makePassageSet(checked);
    commitSets(addWordSet(setsRef.current, set, MAX_PASSAGE_SETS));
    setCurrentId(set.id);
    setPassage(checked.passage);
    setSentences(checked.sentences);
    setQuestions(checked.questions);
    setWrong([]);
    setSummary(null);
    setStep('read');
  }

  function resume(id) {
    const set = findWordSet(setsRef.current, id);
    if (!set) return;
    commitSets(markStudied(setsRef.current, id));
    setCurrentId(id);
    setPassage(set.passage);
    setSentences(set.sentences);
    setQuestions(set.questions);
    setWrong([]);
    setSummary(null);
    setStep('read');
  }

  function remove(id) {
    const set = findWordSet(setsRef.current, id);
    if (!set) return;
    if (!window.confirm('"' + passageSetTitle(set) + '" 지문을 지울까요?')) return;
    commitSets(removeWordSet(setsRef.current, id));
  }

  function startQuiz(qs, which) {
    setQuizQuestions(qs);
    setMode(which);
    setSeedBump((n) => n + 1);
    setStep('quiz');
  }

  function finishQuiz(results) {
    const s = summarizeReading(results);
    setSummary(s);
    setWrong(collectWrongQuestions(quizQuestions, results));
    setStep('result');
  }

  function reset() {
    setStep('upload');
    setCurrentId(null);
    setPassage('');
    setSentences([]);
    setQuestions([]);
    setQuizQuestions([]);
    setSummary(null);
    setWrong([]);
    setGenError('');
  }

  function canJump(key) {
    if (sentences.length === 0) return false;
    if (key === 'quiz') return questions.length > 0;
    if (key === 'evidence') return verifiedCount({ questions }) > 0;
    return true;
  }

  function jump(key) {
    if (!canJump(key)) return;
    if (key === 'upload') return reset();
    if (key === 'quiz') return startQuiz(questions, 'quiz');
    setStep(key);
  }

  const showSteps = step !== 'upload' && step !== 'check';

  return (
    <div className="wl">
      <div className="wl-shell">
        <header className="wl-top">
          <button className="wl-home" onClick={onHome} aria-label="처음 화면으로">
            ← 독해 연습
          </button>
          {sentences.length > 0 && (
            <button className="wl-reset" onClick={reset}>
              새 지문
            </button>
          )}
        </header>

        {showSteps && <Steps items={READ_STEPS} idx={STEP_INDEX[step] ?? 0} onJump={jump} canJump={canJump} />}

        {step === 'upload' && <Upload onExtracted={onExtracted} sets={sets} onResume={resume} onRemove={remove} />}

        {step === 'check' && (
          <Review pending={pending} loading={genLoading} onConfirm={start} onBack={() => setStep('upload')} />
        )}

        {step === 'read' && <Read sentences={sentences} wordIndex={wordIndex} onNext={() => setStep('evidence')} />}

        {step === 'evidence' && (
          <Evidence
            key={'e' + seedBump}
            sentences={sentences}
            questions={questions}
            seed={13 + seedBump}
            onNext={() => startQuiz(questions, 'quiz')}
          />
        )}

        {step === 'quiz' && (
          <>
            {genError && <div className="wl-err">{genError}</div>}
            <Quiz
              key={mode + seedBump}
              questions={quizQuestions}
              seed={(mode === 'review' ? 41 : 17) + seedBump}
              title={mode === 'review' ? '오답 다시 풀기' : '모의 시험'}
              subtitle={
                mode === 'review'
                  ? '아까 놓친 것만 모았어요.'
                  : '실제 시험과 같은 모양이에요. 답을 고른 뒤 근거 문장을 꼭 보세요.'
              }
              onDone={finishQuiz}
            />
          </>
        )}

        {step === 'result' && summary && (
          <Result
            summary={summary}
            mode={mode}
            wrongCount={wrong.length}
            onNext={() => (wrong.length > 0 ? startQuiz(wrong, 'review') : reset())}
            onRetry={() => startQuiz(quizQuestions, mode)}
          />
        )}

        {step !== 'upload' && step !== 'check' && questions.length > 0 && (
          <button className="wl-ghost wl-sm wl-regen" disabled={genLoading} onClick={() => loadQuestions(passage, questions, currentId)}>
            {genLoading ? '문제 만드는 중' : '문제 더 만들기'}
          </button>
        )}
      </div>
    </div>
  );
}
