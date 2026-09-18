import { useState, useEffect } from 'react';
import WordLab from './WordLab.jsx';
import Reading from './Reading.jsx';
import { loadWordSets, loadPassageSets } from './storage.js';
import { initSpeech } from './speech.js';

/* ────────────────────────────────────────────────────────────
   첫 화면 — 무엇을 할지 고른다
   ──────────────────────────────────────────────────────────── */

function Home({ onPick }) {
  const [counts, setCounts] = useState({ words: 0, passages: 0 });

  useEffect(() => {
    initSpeech();
    setCounts({ words: loadWordSets().length, passages: loadPassageSets().length });
  }, []);

  return (
    <div className="wl">
      <div className="wl-shell">
        <header className="wl-top">
          <span className="wl-logo">영어 공부</span>
        </header>

        <div className="wl-pane">
          <h1 className="wl-h1">오늘은 무엇을 할까요?</h1>

          <button className="wl-pick" onClick={() => onPick('words')}>
            <span className="wl-pick-ico">📷</span>
            <span className="wl-pick-body">
              <span className="wl-pick-t">단어 외우기</span>
              <span className="wl-pick-s">단어장 사진으로 시험 준비. 덩어리로 끊어 읽고 틀린 것만 다시 풀어요.</span>
              <span className="wl-pick-n">{counts.words > 0 ? '저장된 단어장 ' + counts.words + '개' : '아직 없어요'}</span>
            </span>
          </button>

          <button className="wl-pick" onClick={() => onPick('reading')}>
            <span className="wl-pick-ico">📖</span>
            <span className="wl-pick-body">
              <span className="wl-pick-t">독해 연습</span>
              <span className="wl-pick-s">지문 사진으로 읽기 시험 준비. 답이 어느 문장에 있는지 찾고 모의 시험을 봐요.</span>
              <span className="wl-pick-n">{counts.passages > 0 ? '저장된 지문 ' + counts.passages + '개' : '아직 없어요'}</span>
            </span>
          </button>

          <p className="wl-note">단어장과 지문은 이 기기(브라우저)에 저장돼요.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState('home');
  const goHome = () => setMode('home');

  if (mode === 'words') return <WordLab onHome={goHome} />;
  if (mode === 'reading') return <Reading onHome={goHome} />;
  return <Home onPick={setMode} />;
}
