// src/speech.js
// 브라우저 음성 합성. README §7 의 편차를 여기서 흡수한다.
// - getVoices() 가 처음엔 빈 배열일 수 있어 voiceschanged 를 구독한다
// - 영어 목소리가 없으면 목소리 지정 없이 lang 만 주고 재생한다
// - 연속 재생 시 앞 음성이 잘리지 않게 매번 cancel() 후 재생한다

let voices = [];

function refreshVoices() {
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    voices = [];
  }
}

export function initSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  refreshVoices();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  } catch {
    /* 구형 브라우저 */
  }
}

export function canSpeak() {
  return typeof window !== 'undefined' && !!window.speechSynthesis;
}

/** 영어 목소리가 하나라도 있는가. 목소리 목록이 아직 안 왔으면(빈 배열) 낙관적으로 true */
export function hasEnglishVoice() {
  if (!canSpeak()) return false;
  if (voices.length === 0) refreshVoices();
  if (voices.length === 0) return true;
  return voices.some((v) => /^en/i.test(v.lang));
}

function pickVoice() {
  return (
    voices.find((v) => /en[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null
  );
}

export function speak(text, rate = 0.8) {
  if (!canSpeak()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'en-US';
    u.rate = rate;
    const v = pickVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
