// src/ui.jsx
// 단어 연습과 독해 연습이 함께 쓰는 화면 조각.

import { speak } from './speech.js';

/** 덩어리 칩. marks[i] 가 true 인 덩어리는 형광 표시한다 */
export function ChunkWord({ chunks, marks, size = 'lg', onChunk }) {
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

export function SpeakBtn({ text, label = '듣기', rate = 0.8, big, lang = 'en-US' }) {
  return (
    <button className={'wl-speak' + (big ? ' wl-speak-big' : '')} onClick={() => speak(text, rate, lang)}>
      <span className="wl-speak-ico">♪</span>
      {label}
    </button>
  );
}

/** 연상 한 줄. 없으면 아무것도 그리지 않는다 */
export function Mnemonic({ tip }) {
  if (!tip) return null;
  return (
    <div className="wl-mnemo">
      <span className="wl-mnemo-ico">💡</span>
      <span>{tip}</span>
    </div>
  );
}

/**
 * 단계 표시. 번호를 누르면 그 단계로 간다 (갈 수 없는 단계는 눌리지 않는다).
 * @param {{key: string, label: string}[]} items
 * @param {number} idx 지금 단계의 자리
 */
export function Steps({ items, idx, onJump, canJump }) {
  return (
    <ol className="wl-steps">
      {items.map((it, i) => {
        const enabled = canJump ? canJump(it.key) : false;
        return (
          <li key={it.key} className={'wl-step ' + (i < idx ? 'done' : i === idx ? 'now' : 'todo')}>
            <button
              type="button"
              className="wl-step-btn"
              disabled={!enabled}
              onClick={() => onJump && onJump(it.key)}
              aria-label={it.label + ' 단계로 가기'}
            >
              <span className="wl-step-n">{i < idx ? '✓' : i + 1}</span>
              <span className="wl-step-l">{it.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
