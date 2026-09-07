import { useState, useEffect, useRef, useCallback } from 'react';
import { buildQuiz, gradeAnswer, summarize, collectWrong, sanitizeWords } from '../shared/wordlab-logic.mjs';
import { flagWords, normalizeLetters, highlightChunks, sanitizePhonics, splitStory } from '../shared/extract-logic.mjs';
import { buildAssembly, gradeAssembly } from '../shared/assembly.mjs';
import { parseWordLines } from '../shared/manual-entry.mjs';
import { speak, initSpeech, hasEnglishVoice, hasVoice } from './speech.js';
import {
  prepareImage,
  extractFromImage,
  extractPhonics,
  extractStory,
  getPasscode,
  setPasscode,
  fetchRemoteSets,
  pushRemoteSet,
  deleteRemoteSet,
} from './api.js';
import { loadWordSets, saveWordSets } from './storage.js';
import {
  MAX_WORDSETS,
  makeWordSet,
  addWordSet,
  removeWordSet,
  updateWordSet,
  findWordSet,
  wordSetTitle,
  mergeWordSets,
} from '../shared/wordsets.mjs';

/* ────────────────────────────────────────────────────────────
   공용 조각
   ──────────────────────────────────────────────────────────── */

function ChunkWord({ chunks, marks, size = 'lg', onChunk }) {
  return (
    <span className={'wl-chunkrow wl-chunkrow-' + size}>
      {chunks.map((c, i) => {
        const hit = !!marks?.[i];
        return (
          <span
            key={i}
            className={'wl-chunk ' + (i % 2 ? 'wl-chunk-b' : 'wl-chunk-a') + (hit ? ' wl-chunk-hit' : '')}
            onClick={() => onChunk && onChunk(c)}
            role={onChunk ? 'button' : undefined}
            tabIndex={onChunk ? 0 : undefined}
            onKeyDown={(e) => {
              if (onChunk && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onChunk(c);
              }
            }}
          >
            {c}
          </span>
        );
      })}
    </span>
  );
}

function SpeakBtn({ text, label = '듣기', rate = 0.8, big, lang = 'en-US' }) {
  return (
    <button className={'wl-speak' + (big ? ' wl-speak-big' : '')} onClick={() => speak(text, rate, lang)}>
      <span className="wl-speak-ico">♪</span>
      {label}
    </button>
  );
}

const STEP_KEYS = ['upload', 'phonics', 'chunks', 'quiz', 'review', 'final'];

/** 상단 단계 표시. 번호를 누르면 그 단계로 바로 간다 (갈 수 없는 단계는 눌리지 않는다) */
function Steps({ current, onJump, canJump }) {
  const items = ['사진', '파닉스', '덩어리', '시험', '오답', '최종'];
  // 조립·이야기는 "덩어리" 단계 안의 연습이므로 같은 칸에 둔다 (칸을 늘리면 폰에서 글자가 깨진다)
  const idx =
    { upload: 0, check: 0, phonics: 1, chunks: 2, assemble: 2, story: 2, quiz: 3, review: 4, final: 5, done: 5 }[current] ?? 0;
  return (
    <ol className="wl-steps">
      {items.map((label, i) => {
        const key = STEP_KEYS[i];
        const enabled = canJump ? canJump(key) : false;
        return (
          <li key={label} className={'wl-step ' + (i < idx ? 'done' : i === idx ? 'now' : 'todo')}>
            <button
              type="button"
              className="wl-step-btn"
              disabled={!enabled}
              onClick={() => onJump && onJump(key)}
              aria-label={label + ' 단계로 가기'}
            >
              <span className="wl-step-n">{i < idx ? '✓' : i + 1}</span>
              <span className="wl-step-l">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ────────────────────────────────────────────────────────────
   1. 사진 올리기
   ──────────────────────────────────────────────────────────── */

function Upload({ onExtracted, onManual, sets, syncNote, onResume, onRemove }) {
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
      let cut = false;
      for (let i = 0; i < files.length; i++) {
        setNote(files.length + '장 중 ' + (i + 1) + '번째 사진을 읽는 중');
        const image = await prepareImage(files[i]);
        const got = await extractFromImage(image);
        all.push(...got.words);
        if (got.status === 'truncated') cut = true;
      }
      const merged = sanitizeWords(all, { keepEmptyMeaning: true });
      if (merged.length === 0) throw new Error('단어를 찾지 못했어요. 글자가 잘 보이게 다시 찍어주세요.');
      setNeedPasscode(false);
      onExtracted(merged, cut);
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
        단어장 사진을 올리면
        <br />
        오늘 공부가 만들어져요
      </h1>
      <p className="wl-sub">사진에서 단어와 뜻을 읽어내고, 공통 파닉스 규칙 다섯 개를 뽑아 시험까지 이어집니다.</p>

      <div className="wl-drop" onClick={() => !busy && inputRef.current?.click()}>
        <div className="wl-drop-ico">📷</div>
        <div className="wl-drop-t">{files.length ? files.length + '장 선택함' : '사진 고르기'}</div>
        <div className="wl-drop-s">한 번에 여러 장 가능. 한 장에 15개 이하면 잘 읽어요.</div>
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
          <label className="wl-passlabel" htmlFor="wl-pass">
            비밀번호를 넣어주세요. 아빠가 알고 있어요.
          </label>
          <input
            id="wl-pass"
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
        {busy ? note || '읽는 중' : '단어 뽑기'}
      </button>

      {busy && (
        <div className="wl-bar">
          <span />
        </div>
      )}

      {!busy && (
        <button className="wl-ghost" onClick={onManual}>
          사진 없이 직접 넣기
        </button>
      )}

      {!busy && (
        <p className="wl-note">
          단어장은 이 기기(브라우저)에 저장돼요. 다른 기기에도 올라간 것은 "다른 기기에도 있음"이라고 표시돼요.
        </p>
      )}

      {sets.length > 0 && !busy && (
        <div className="wl-sets">
          <div className="wl-sets-h">
            지난 단어장 <span className="wl-sets-n">{sets.length} / {MAX_WORDSETS}</span>
          </div>
          {syncNote && <div className="wl-warn">{syncNote}</div>}
          {sets.map((s) => (
            <div className="wl-set" key={s.id}>
              <button className="wl-set-main" onClick={() => onResume(s.id)}>
                <span className="wl-set-t">{wordSetTitle(s)}</span>
                <span className="wl-set-s">
                  {s.words.length}개 단어 · 이어서 하기{s.synced ? ' · 다른 기기에도 있음' : ''}
                </span>
              </button>
              <button className="wl-x" onClick={() => onRemove(s.id)} aria-label="이 단어장 지우기">
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
   1.5 검수 — 저장 전에 부모가 단어·뜻·덩어리를 확인하고 고친다
   ──────────────────────────────────────────────────────────── */

const FLAG_LABEL = {
  'empty-word': '단어가 비었어요',
  'empty-meaning': '뜻이 비었어요',
  'short-meaning': '뜻이 너무 짧아요',
  'dup-meaning': '다른 단어와 뜻이 같아요',
  'chunk-mismatch': '덩어리를 이어붙이면 단어와 달라요',
  'chunk-fallback': '덩어리가 나뉘지 않았어요',
};

function rowToWord(r) {
  const word = r.word.trim();
  const chunks = r.chunksText
    .split(/[-·/|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { word, meaning: r.meaning.trim(), chunks: chunks.length ? chunks : [word] };
}

const blankRow = () => ({ word: '', meaning: '', chunksText: '' });
const isBlankRow = (r) => !r.word.trim() && !r.meaning.trim() && !r.chunksText.trim();

function Review({ words, truncated, manual, onConfirm, onBack }) {
  const [rows, setRows] = useState(() =>
    manual ? [blankRow()] : words.map((w) => ({ word: w.word, meaning: w.meaning, chunksText: w.chunks.join('-') }))
  );
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(!!manual);
  // 완전히 빈 줄은 아직 안 쓴 줄이므로 표시하지 않는다
  const flags = rows.map((r, i) => (isBlankRow(r) ? [] : flagWords([rowToWord(r)])[0]));
  const dupFlags = flagWords(rows.map(rowToWord)); // 뜻 중복은 전체를 봐야 한다
  rows.forEach((r, i) => {
    if (!isBlankRow(r) && dupFlags[i].includes('dup-meaning') && !flags[i].includes('dup-meaning')) flags[i].push('dup-meaning');
  });
  const liveCount = rows.filter((r) => !isBlankRow(r)).length;
  const flaggedCount = flags.filter((f) => f.length).length;

  function update(i, key, value) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  }
  function remove(i) {
    setRows((rs) => rs.filter((_, j) => j !== i));
  }
  function add() {
    setRows((rs) => [...rs, blankRow()]);
  }
  /** 여러 줄 붙여넣기 → 행으로. 빈 줄은 치우고 뒤에 붙인다 */
  function applyPaste() {
    const parsed = parseWordLines(paste);
    if (parsed.length === 0) {
      setErr('읽을 수 있는 줄이 없어요. 한 줄에 "creature 생명체"처럼 영어 단어와 뜻을 적어주세요.');
      return;
    }
    setRows((rs) => [
      ...rs.filter((r) => !isBlankRow(r)),
      ...parsed.map((p) => ({ word: p.word, meaning: p.meaning, chunksText: p.chunks.join('-') })),
    ]);
    setPaste('');
    setPasteOpen(false);
    setErr('');
  }
  function confirm() {
    const live = rows.filter((r) => !isBlankRow(r));
    const blanks = live.filter((r) => !r.word.trim() || !r.meaning.trim()).length;
    if (blanks > 0) {
      setErr('빈 칸이 ' + blanks + '줄 있어요. 채우거나 그 줄을 지워주세요.');
      return;
    }
    const clean = sanitizeWords(live.map(rowToWord));
    if (clean.length === 0) {
      setErr('단어가 하나도 없어요. 단어와 뜻을 채워주세요.');
      return;
    }
    setErr('');
    onConfirm(clean);
  }

  return (
    <div className="wl-pane">
      <h2 className="wl-h2">{manual ? '단어를 직접 넣어주세요' : '뽑은 단어 ' + liveCount + '개를 확인해 주세요'}</h2>
      <p className="wl-sub">
        {manual
          ? '표에 바로 적거나, 아래에 여러 줄을 붙여 넣어요. 덩어리는 -로 나눠 적어요 (crea-ture).'
          : '틀린 뜻을 그대로 두면 아이가 틀린 답을 외워요. 칸을 눌러 바로 고칠 수 있어요. 덩어리는 -로 나눠 적어요.'}
      </p>

      {pasteOpen ? (
        <div className="wl-pastebox">
          <textarea
            className="wl-paste"
            rows={6}
            value={paste}
            placeholder={'한 줄에 하나씩\ncrea-ture 생명체\nmantis shrimp 갯가재\nbright-ly 밝게, 선명하게'}
            onChange={(e) => setPaste(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="wl-row">
            <button className="wl-ghost" onClick={() => setPasteOpen(false)}>
              닫기
            </button>
            <button className="wl-cta wl-inline" disabled={!paste.trim()} onClick={applyPaste}>
              표에 넣기
            </button>
          </div>
        </div>
      ) : (
        <button className="wl-ghost wl-sm" onClick={() => setPasteOpen(true)}>
          여러 줄 붙여넣기
        </button>
      )}
      {truncated && (
        <div className="wl-err">사진 한 장에 단어가 너무 많아서 일부를 놓쳤을 수 있어요. 빠진 단어는 아래에서 직접 추가해 주세요.</div>
      )}
      {flaggedCount > 0 && (
        <div className="wl-warn">노란 줄 {flaggedCount}개는 한 번 더 봐주세요.</div>
      )}

      <div className="wl-tablewrap">
        <table className="wl-table">
          <thead>
            <tr>
              <th>단어</th>
              <th>뜻</th>
              <th>덩어리</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={flags[i].length ? 'flagged' : ''}>
                <td>
                  <input
                    className="wl-cell"
                    value={r.word}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => update(i, 'word', e.target.value)}
                  />
                </td>
                <td>
                  <input className="wl-cell" value={r.meaning} onChange={(e) => update(i, 'meaning', e.target.value)} />
                </td>
                <td>
                  <input
                    className="wl-cell wl-cell-chunks"
                    value={r.chunksText}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => update(i, 'chunksText', e.target.value)}
                  />
                  {flags[i].length > 0 && (
                    <div className="wl-flags">{flags[i].map((f) => FLAG_LABEL[f]).join(' · ')}</div>
                  )}
                </td>
                <td>
                  <button className="wl-x" onClick={() => remove(i)} aria-label="이 줄 지우기">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="wl-ghost" onClick={add}>
        단어 한 줄 추가
      </button>

      {err && <div className="wl-err">{err}</div>}

      <p className="wl-note">시작을 누르면 이 단어장이 이 기기(브라우저)에 저장돼요.</p>

      <div className="wl-row">
        <button className="wl-ghost" onClick={onBack}>
          {manual ? '처음으로' : '사진 다시 고르기'}
        </button>
        <button className="wl-cta wl-inline" onClick={confirm}>
          이대로 시작
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   2. 파닉스
   ──────────────────────────────────────────────────────────── */

function Phonics({ phonics: rawPhonics, loading, error, words, onNext, onRefresh }) {
  const byWord = Object.fromEntries(words.map((w) => [w.word, w]));
  // 서버가 이미 걸렀지만, 예전에 저장된 단어장에도 같은 기준을 적용한다 (규칙 글자가 없는 단어 제거)
  const phonics = sanitizePhonics(rawPhonics, words);
  return (
    <div className="wl-pane">
      <h2 className="wl-h2">{loading ? '오늘 단어에 숨은 규칙을 찾는 중' : '오늘 단어에 숨은 규칙 ' + phonics.length + '개'}</h2>
      <p className="wl-sub">규칙 하나를 알면 단어 여러 개가 한꺼번에 풀려요. 단어를 눌러 소리를 들어보세요.</p>

      {loading && (
        <div className="wl-bar">
          <span />
        </div>
      )}
      {error && <div className="wl-err">{error}</div>}
      {!loading && !error && phonics.length === 0 && (
        <div className="wl-err">규칙을 만들지 못했어요. 다음 단계로 넘어가도 괜찮아요.</div>
      )}

      {phonics.map((p, i) => (
        <div className="wl-rule" key={i}>
          <div className="wl-rule-head">
            <span className="wl-pattern">{p.pattern}</span>
            <span className="wl-sound">{p.sound}</span>
          </div>
          <p className="wl-tip">{p.tip}</p>
          <div className="wl-rule-words">
            {(p.words || []).map((w) => {
              const item = byWord[w] || { word: w, chunks: [w] };
              const letters = normalizeLetters(p.letters, p.pattern);
              return (
                <button key={w} className="wl-wordpill" onClick={() => speak(item.word)}>
                  <ChunkWord chunks={item.chunks} marks={highlightChunks(item.chunks, letters)} size="sm" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button className="wl-cta" onClick={onNext}>
        덩어리로 읽어보기
      </button>
      {!loading && (
        <button className="wl-ghost" onClick={onRefresh}>
          규칙 다시 뽑기
        </button>
      )}
      {!loading && <p className="wl-note">사진은 다시 읽지 않고 단어 목록으로만 규칙을 새로 만들어요. 아빠가 규칙이 이상할 때 눌러요.</p>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   3. 덩어리 읽기
   ──────────────────────────────────────────────────────────── */

/** 연상 한 줄. 없으면 아무것도 그리지 않는다 */
function Mnemonic({ tip }) {
  if (!tip) return null;
  return (
    <div className="wl-mnemo">
      <span className="wl-mnemo-ico">💡</span>
      <span>{tip}</span>
    </div>
  );
}

function Chunks({ words, mnemonics, onNext }) {
  const [i, setI] = useState(0);
  const w = words[i];
  const last = i === words.length - 1;
  const noVoice = !hasEnglishVoice();

  useEffect(() => {
    speak(w.word);
  }, [i]); // eslint-disable-line

  return (
    <div className="wl-pane">
      <div className="wl-count">
        {i + 1} / {words.length}
      </div>

      {noVoice && (
        <div className="wl-warn">이 기기에는 영어 목소리가 없어요. 소리가 안 나면 기기 설정에서 영어 음성을 추가해 주세요.</div>
      )}

      <div className="wl-stage">
        <ChunkWord chunks={w.chunks} onChunk={(c) => speak(c, 0.6)} />
        <div className="wl-meaning">{w.meaning}</div>
        <Mnemonic tip={mnemonics?.[w.word]} />
        <div className="wl-row">
          <SpeakBtn text={w.word} label="듣기" big />
          <SpeakBtn text={w.word} label="천천히" rate={0.5} big />
        </div>
        <p className="wl-note">덩어리를 하나씩 누르면 그 부분만 들려요. 입으로 따라 말하면서 손으로 써보세요.</p>
      </div>

      <div className="wl-row">
        <button className="wl-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          이전
        </button>
        {last ? (
          <button className="wl-cta wl-inline" onClick={onNext}>
            덩어리 맞추기
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
   3-2. 덩어리 맞추기 — 섞인 덩어리를 순서대로 눌러 단어를 만든다 (연습, 채점 없음)
   ──────────────────────────────────────────────────────────── */

function Assemble({ words, seed, onNext }) {
  const [items] = useState(() => buildAssembly(words, { seed }));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState([]); // 누른 순서대로의 pool 인덱스
  const [judged, setJudged] = useState(null);
  const item = items[i];
  const last = i === items.length - 1;

  if (!item) return null;
  // 이전 단어의 인덱스가 한 렌더 동안 남을 수 있으므로(다음 단어의 덩어리 수가 더 적을 때) 없는 칩은 건너뛴다
  const pickedChunks = picked.map((k) => item.pool[k]?.c ?? '');

  /** 다음 단어로. 누른 칩과 판정을 같은 렌더에서 함께 비운다 */
  function goNext() {
    if (last) return onNext();
    setPicked([]);
    setJudged(null);
    setI(i + 1);
  }

  function pick(k) {
    if (judged || picked.includes(k)) return;
    speak(item.pool[k].c, 0.6);
    const next = [...picked, k];
    setPicked(next);
    if (next.length === item.chunks.length) {
      const g = gradeAssembly(item.chunks, next.map((x) => item.pool[x].c));
      setJudged(g);
      if (g.correct) setTimeout(() => speak(item.word), 450);
    }
  }
  function unpick(pos) {
    if (judged) return;
    setPicked(picked.filter((_, p) => p !== pos));
  }
  function retry() {
    setPicked([]);
    setJudged(null);
  }

  return (
    <div className="wl-pane">
      <div className="wl-quizhead">
        <span className="wl-badge">덩어리 맞추기</span>
        <span className="wl-count">
          {i + 1} / {items.length}
        </span>
      </div>
      <p className="wl-sub">뜻을 보고 덩어리를 순서대로 눌러 단어를 만들어요. 누르면 그 덩어리 소리가 나요.</p>

      <div className="wl-stage">
        <div className="wl-prompt">{item.meaning}</div>

        <div className="wl-slots" aria-label="만든 단어">
          {item.chunks.map((_, pos) =>
            pos < picked.length ? (
              <button
                key={pos}
                className={'wl-chunk ' + (pos % 2 ? 'wl-chunk-b' : 'wl-chunk-a')}
                onClick={() => unpick(pos)}
                aria-label={pickedChunks[pos] + ' 빼기'}
              >
                {pickedChunks[pos]}
              </button>
            ) : (
              <span key={pos} className="wl-slot" />
            )
          )}
        </div>

        {!judged && (
          <>
            <div className="wl-pool">
              {item.pool.map((p, k) => (
                <button
                  key={k}
                  className={'wl-poolchip' + (picked.includes(k) ? ' used' : '')}
                  disabled={picked.includes(k)}
                  onClick={() => pick(k)}
                >
                  {p.c}
                </button>
              ))}
            </div>
            <div className="wl-row wl-center">
              <SpeakBtn text={item.word} label="듣기" />
              <button className="wl-ghost wl-sm" disabled={picked.length === 0} onClick={retry}>
                처음부터
              </button>
            </div>
          </>
        )}

        {judged && (
          <div className={'wl-verdict ' + (judged.correct ? 'ok' : 'no')}>
            <div className="wl-verdict-t">{judged.correct ? '맞았어요' : '정답을 볼까요'}</div>
            <ChunkWord chunks={item.chunks} onChunk={(c) => speak(c, 0.6)} />
            {!judged.correct && judged.matchedChunks > 0 && (
              <p className="wl-note">앞의 {judged.matchedChunks}덩어리는 맞았어요. 뒤만 다시 보면 돼요.</p>
            )}
            <div className="wl-row">
              {!judged.correct && (
                <button className="wl-ghost" onClick={retry}>
                  다시 맞추기
                </button>
              )}
              <button className="wl-cta wl-inline" onClick={goNext}>
                {last ? '이야기 보러 가기' : '다음'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   3-3. 이야기 — 오늘 단어가 섞인 짧은 한국어 이야기 (재미, 시험과 무관)
   ──────────────────────────────────────────────────────────── */

function Story({ story, loading, error, words, onNext, onRefresh }) {
  const parts = splitStory(story, words);
  return (
    <div className="wl-pane">
      <h2 className="wl-h2">{loading ? '오늘 단어로 이야기를 만드는 중' : '오늘 단어로 만든 이야기'}</h2>
      <p className="wl-sub">파란 단어를 누르면 소리가 나요. 시험에는 안 나오는 재미 시간이에요.</p>

      {loading && (
        <div className="wl-bar">
          <span />
        </div>
      )}
      {error && <div className="wl-err">{error}</div>}

      {story && (
        <>
          <div className="wl-story">
            {parts.map((p, k) =>
              p.word ? (
                <button key={k} className="wl-storyword" onClick={() => speak(p.word)}>
                  {p.text}
                </button>
              ) : (
                <span key={k}>{p.text}</span>
              )
            )}
          </div>
          {hasVoice('ko') && (
            <div className="wl-row wl-center">
              <SpeakBtn text={story} label="이야기 듣기" rate={0.95} lang="ko-KR" />
            </div>
          )}
        </>
      )}

      <button className="wl-cta" onClick={onNext}>
        시험 보러 가기
      </button>
      {!loading && (
        <button className="wl-ghost" onClick={onRefresh}>
          이야기 다시 만들기
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   4·5·6. 시험 / 오답 / 최종
   ──────────────────────────────────────────────────────────── */

const TYPE_LABEL = { spell: '뜻 보고 쓰기', listen: '듣고 쓰기', meaning: '뜻 고르기' };

function Quiz({ words, seed, title, subtitle, mnemonics, onDone }) {
  // 영어 목소리가 없는 기기에서는 받아쓰기 유형을 뺀다 (README §7)
  const [quiz] = useState(() =>
    buildQuiz(words, { seed, types: hasEnglishVoice() ? ['spell', 'listen', 'meaning'] : ['spell', 'meaning'] })
  );
  const [i, setI] = useState(0);
  const [value, setValue] = useState('');
  const [judged, setJudged] = useState(null);
  const [results, setResults] = useState([]);
  const [hintOn, setHintOn] = useState(false);
  const inputRef = useRef(null);

  const q = quiz[i];

  useEffect(() => {
    setValue('');
    setJudged(null);
    setHintOn(false);
    if (q?.type === 'listen') speak(q.word);
    if (q?.type !== 'meaning') setTimeout(() => inputRef.current?.focus(), 60);
  }, [i]); // eslint-disable-line

  const check = useCallback(
    (raw) => {
      if (judged) return;
      const g = gradeAnswer(q, raw);
      setJudged(g);
      if (g.correct) speak(q.word);
      setResults((r) => [...r, { word: q.word, correct: g.correct }]);
    },
    [judged, q]
  );

  function next() {
    if (i === quiz.length - 1) onDone(results);
    else setI(i + 1);
  }

  if (!q) return null;

  return (
    <div className="wl-pane">
      <div className="wl-quizhead">
        <span className="wl-badge">{TYPE_LABEL[q.type]}</span>
        <span className="wl-count">
          {i + 1} / {quiz.length}
        </span>
      </div>
      <div className="wl-progress">
        <span style={{ width: (i / quiz.length) * 100 + '%' }} />
      </div>
      <h2 className="wl-h2 wl-h2-tight">{title}</h2>
      {subtitle && <p className="wl-sub">{subtitle}</p>}

      <div className="wl-stage">
        {q.type === 'spell' && <div className="wl-prompt">{q.meaning}</div>}
        {q.type === 'meaning' && <div className="wl-prompt wl-prompt-en">{q.word}</div>}
        {q.type === 'listen' && (
          <div className="wl-row wl-center">
            <SpeakBtn text={q.word} label="다시 듣기" big />
            <SpeakBtn text={q.word} label="천천히" rate={0.5} big />
          </div>
        )}

        {q.type === 'meaning' ? (
          <div className="wl-options">
            {q.options.map((opt) => (
              <button
                key={opt}
                className={
                  'wl-opt' +
                  (judged && opt === q.meaning ? ' ok' : '') +
                  (judged && !judged.correct && opt !== q.meaning ? ' dim' : '')
                }
                disabled={!!judged}
                onClick={() => check(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              className={'wl-input' + (judged ? (judged.correct ? ' ok' : ' no') : '')}
              value={value}
              placeholder="영어로 쓰기"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={!!judged}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') check(value);
              }}
            />
            {!judged && (
              <div className="wl-row wl-center">
                <button className="wl-ghost wl-sm" onClick={() => setHintOn(true)}>
                  힌트
                </button>
                <button className="wl-ghost wl-sm" onClick={() => check('')}>
                  모르겠어요
                </button>
              </div>
            )}
            {hintOn && !judged && (
              <div className="wl-hint">
                <span className="wl-hint-mask">{q.hint}</span>
                <span className="wl-hint-meaning">{q.meaning}</span>
              </div>
            )}
            {!judged && (
              <button className="wl-cta" onClick={() => check(value)}>
                확인
              </button>
            )}
          </>
        )}

        {judged && (
          <div className={'wl-verdict ' + (judged.correct ? 'ok' : 'no')}>
            <div className="wl-verdict-t">{judged.correct ? '맞았어요' : '정답을 볼까요'}</div>
            <ChunkWord chunks={q.chunks} onChunk={(c) => speak(c, 0.6)} />
            <div className="wl-meaning">{q.meaning}</div>
            {!judged.correct && judged.matched > 0 && (
              <p className="wl-note">앞의 {judged.matched}글자는 맞았어요. 뒷부분만 다시 보면 돼요.</p>
            )}
            <Mnemonic tip={mnemonics?.[q.word]} />
            <button className="wl-cta" onClick={next}>
              {i === quiz.length - 1 ? '결과 보기' : '다음'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Result({ summary, words, mode, onNext, onRetry }) {
  const good = summary.percent >= 80;
  return (
    <div className="wl-pane">
      <div className="wl-score">
        <span className="wl-score-n">{summary.correct}</span>
        <span className="wl-score-d">/ {summary.total}</span>
      </div>
      <h2 className="wl-h2 wl-center-t">{good ? '잘했어요' : summary.correct > 0 ? '여기까지 왔어요' : '이제 시작이에요'}</h2>

      {summary.wrong.length > 0 ? (
        <>
          <p className="wl-sub">다시 볼 단어 {summary.wrong.length}개예요. 맞힌 건 넘어가고 이것만 돌릴게요.</p>
          <div className="wl-wronglist">
            {words
              .filter((w) => summary.wrong.includes(w.word))
              .map((w) => (
                <button key={w.word} className="wl-wordpill" onClick={() => speak(w.word)}>
                  <ChunkWord chunks={w.chunks} size="sm" />
                  <span className="wl-pill-meaning">{w.meaning}</span>
                </button>
              ))}
          </div>
          <button className="wl-cta" onClick={onNext}>
            {mode === 'final' ? '틀린 것만 한 번 더' : '틀린 것만 다시 풀기'}
          </button>
        </>
      ) : (
        <p className="wl-sub">전부 맞혔어요. 오답 단계는 건너뛸게요.</p>
      )}

      {summary.wrong.length === 0 && (
        <button className="wl-cta" onClick={onNext}>
          {mode === 'final' ? '처음으로' : '최종 시험 보기'}
        </button>
      )}
      {mode !== 'final' && (
        <button className="wl-ghost" onClick={onRetry}>
          이 단계 다시 풀기
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   앱
   ──────────────────────────────────────────────────────────── */

export default function WordLab() {
  const [step, setStep] = useState('upload');
  const [words, setWords] = useState([]);
  const [pending, setPending] = useState({ words: [], truncated: false, manual: false });
  const [phonics, setPhonics] = useState([]);
  const [phonicsLoading, setPhonicsLoading] = useState(false);
  const [phonicsError, setPhonicsError] = useState('');
  const [mnemonics, setMnemonics] = useState({});
  const [story, setStory] = useState('');
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState('');
  const [wrongWords, setWrongWords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [stage, setStage] = useState('quiz');
  const [sets, setSets] = useState([]);
  const setsRef = useRef([]); // 비동기 콜백(규칙 도착)에서 최신 목록을 보기 위한 거울
  const [currentId, setCurrentId] = useState(null);
  const [syncNote, setSyncNote] = useState('');
  const [seedBump, setSeedBump] = useState(0);

  useEffect(() => {
    commitSets(loadWordSets());
    initSpeech();
    // 다른 기기에서 올린 단어장을 받아와 합친다. 실패해도 이 기기 것으로 계속
    fetchRemoteSets()
      .then((r) => {
        if (Array.isArray(r?.sets) && r.sets.length) commitSets(mergeWordSets(setsRef.current, r.sets));
      })
      .catch(() => {});
  }, []);

  /** 목록 상태와 localStorage 를 함께 바꾼다 */
  function commitSets(next) {
    setsRef.current = next;
    setSets(next);
    saveWordSets(next);
  }

  /** 단어장 하나를 공유 저장에 올린다 (같은 id 면 교체). 꺼져 있으면 조용히 넘어간다 */
  async function syncSet(id) {
    const set = findWordSet(setsRef.current, id);
    if (!set) return;
    try {
      await pushRemoteSet(set);
      commitSets(updateWordSet(setsRef.current, id, { synced: true }));
      setSyncNote('');
    } catch (e) {
      // 꺼져 있는 건 고칠 게 없으니 조용히. 실패는 무엇이 됐고 안 됐는지 알린다
      setSyncNote(e.disabled ? '' : e.message || '다른 기기에는 저장하지 못했어요. 이 기기에는 저장됐어요.');
    }
  }

  function onExtracted(w, truncated) {
    setPending({ words: w, truncated, manual: false });
    setStep('check');
  }

  /** 사진 없이 표에 직접 적어 단어장을 만든다 */
  function startManual() {
    setPending({ words: [], truncated: false, manual: true });
    setStep('check');
  }

  /** 단계 번호를 눌러 이동할 수 있는가 */
  function canJump(key) {
    if (words.length === 0) return false;
    if (key === 'review') return wrongWords.length > 0;
    return true;
  }

  /** 단계 번호로 바로 이동. 시험류는 새 문제지로 다시 시작한다 */
  function jump(key) {
    if (!canJump(key)) return;
    if (key === 'upload') {
      reset();
      return;
    }
    if (key === 'quiz' || key === 'review' || key === 'final') {
      setSeedBump((n) => n + 1);
      setStage(key);
    }
    setStep(key);
  }

  /** 단어 목록만 보내 규칙을 (다시) 만든다. 사진은 다시 읽지 않는다 */
  async function loadPhonics(w, id) {
    setPhonicsLoading(true);
    setPhonicsError('');
    try {
      const got = await extractPhonics(w);
      const rules = got.phonics || [];
      const tips = got.mnemonics || {};
      setPhonics(rules);
      setMnemonics(tips);
      commitSets(updateWordSet(setsRef.current, id, { phonics: rules, mnemonics: tips }));
    } catch (e) {
      // 규칙이 없어도 학습은 계속. 무엇이 잘못됐는지는 화면에 남긴다
      setPhonicsError(e.message || '규칙을 만들지 못했어요. 다음 단계로 넘어가도 괜찮아요.');
    } finally {
      setPhonicsLoading(false);
      // 규칙까지 붙은 단어장을 다른 기기와 나눈다 (시작 1회 + 규칙 다시 뽑기마다 1회)
      syncSet(id);
    }
  }

  /** 이야기를 (다시) 만든다. 단어장에 저장되어 다음에는 부르지 않는다 */
  async function loadStory(w, id) {
    setStoryLoading(true);
    setStoryError('');
    try {
      const got = await extractStory(w);
      if (got.story) {
        setStory(got.story);
        commitSets(updateWordSet(setsRef.current, id, { story: got.story }));
        syncSet(id);
      } else {
        setStoryError('이야기를 만들지 못했어요. 시험으로 넘어가도 괜찮아요.');
      }
    } catch (e) {
      setStoryError(e.message || '이야기를 만들지 못했어요. 시험으로 넘어가도 괜찮아요.');
    } finally {
      setStoryLoading(false);
    }
  }

  // 이야기 화면에 처음 들어올 때 한 번만 만든다
  useEffect(() => {
    if (step === 'story' && !story && !storyLoading && !storyError && words.length) loadStory(words, currentId);
  }, [step]); // eslint-disable-line

  /** 검수를 마친 단어장으로 시작. 목록 맨 앞에 저장되고 오래된 것은 밀려난다 */
  function start(w) {
    const set = makeWordSet(w, []);
    commitSets(addWordSet(setsRef.current, set));
    setCurrentId(set.id);
    setWords(w);
    setPhonics([]);
    setMnemonics({});
    setStory('');
    setStoryError('');
    setStep('phonics');
    loadPhonics(w, set.id);
  }

  function resume(id) {
    const set = findWordSet(setsRef.current, id);
    if (!set) return;
    setCurrentId(id);
    setWords(set.words);
    setPhonics(set.phonics || []);
    setMnemonics(set.mnemonics || {});
    setStory(set.story || '');
    setStoryError('');
    setStep('phonics');
  }

  /** 덩어리가 2개 이상인 단어가 하나도 없으면 조립 단계는 건너뛴다 */
  function afterChunks() {
    setStep(words.some((w) => Array.isArray(w.chunks) && w.chunks.length >= 2) ? 'assemble' : 'story');
  }

  function remove(id) {
    const set = findWordSet(setsRef.current, id);
    if (!set) return;
    if (!window.confirm('"' + wordSetTitle(set) + '" 단어장을 지울까요?')) return;
    commitSets(removeWordSet(setsRef.current, id));
    if (set.synced) {
      deleteRemoteSet(id).catch((e) => {
        if (!e.disabled) setSyncNote(e.message || '다른 기기에서는 지우지 못했어요. 이 기기에서는 지워졌어요.');
      });
    }
  }

  function finishStage(results, mode) {
    const s = summarize(results);
    setSummary(s);
    setWrongWords(collectWrong(mode === 'review' ? wrongWords : words, results));
    setStage(mode);
    setStep('result');
  }

  function afterResult() {
    if (stage === 'quiz') {
      setStep(wrongWords.length > 0 ? 'review' : 'final');
    } else if (stage === 'review') {
      setStep('final');
    } else if (wrongWords.length > 0) {
      setStage('quiz');
      setStep('review');
    } else {
      reset();
    }
  }

  function reset() {
    setStep('upload');
    setWords([]);
    setPhonics([]);
    setWrongWords([]);
    setSummary(null);
    setCurrentId(null);
  }

  const shellStep = step === 'result' ? (stage === 'final' ? 'final' : stage) : step;
  const showSteps = step !== 'upload' && step !== 'check';

  return (
    <div className="wl">
      <div className="wl-shell">
        <header className="wl-top">
          <span className="wl-logo">단어 연습</span>
          {(words.length > 0 || step === 'check') && (
            <button className="wl-reset" onClick={reset}>
              새 단어장
            </button>
          )}
        </header>

        {showSteps && <Steps current={shellStep} onJump={jump} canJump={canJump} />}

        {step === 'upload' && (
          <Upload
            onExtracted={onExtracted}
            onManual={startManual}
            sets={sets}
            syncNote={syncNote}
            onResume={resume}
            onRemove={remove}
          />
        )}

        {step === 'check' && (
          <Review
            key={pending.manual ? 'manual' : 'photo'}
            words={pending.words}
            truncated={pending.truncated}
            manual={pending.manual}
            onConfirm={start}
            onBack={() => setStep('upload')}
          />
        )}

        {step === 'phonics' && (
          <Phonics
            phonics={phonics}
            loading={phonicsLoading}
            error={phonicsError}
            words={words}
            onNext={() => setStep('chunks')}
            onRefresh={() => loadPhonics(words, currentId)}
          />
        )}

        {step === 'chunks' && <Chunks words={words} mnemonics={mnemonics} onNext={afterChunks} />}

        {step === 'assemble' && <Assemble words={words} seed={7} onNext={() => setStep('story')} />}

        {step === 'story' && (
          <Story
            story={story}
            loading={storyLoading}
            error={storyError}
            words={words}
            onNext={() => setStep('quiz')}
            onRefresh={() => loadStory(words, currentId)}
          />
        )}

        {step === 'quiz' && (
          <Quiz
            key={'q' + seedBump}
            words={words}
            seed={11 + seedBump}
            title="1차 시험"
            subtitle="틀려도 괜찮아요. 틀린 것만 따로 모아둘게요."
            mnemonics={mnemonics}
            onDone={(r) => finishStage(r, 'quiz')}
          />
        )}

        {step === 'review' && (
          <Quiz
            key={'r' + seedBump}
            words={wrongWords}
            seed={29 + seedBump}
            title="오답 복습"
            subtitle="아까 놓친 것만 모았어요."
            mnemonics={mnemonics}
            onDone={(r) => finishStage(r, 'review')}
          />
        )}

        {step === 'final' && (
          <Quiz
            key={'f' + seedBump}
            words={words}
            seed={97 + seedBump}
            title="최종 시험"
            subtitle="전체 단어를 순서 바꿔서 한 번에."
            mnemonics={mnemonics}
            onDone={(r) => finishStage(r, 'final')}
          />
        )}

        {step === 'result' && summary && (
          <Result
            summary={summary}
            words={words}
            mode={stage}
            onNext={afterResult}
            onRetry={() => {
              setSeedBump((n) => n + 1);
              setStep(stage);
            }}
          />
        )}
      </div>
    </div>
  );
}
