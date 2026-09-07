// src/speech.js
// 브라우저 음성 합성. README §7 의 편차를 여기서 흡수한다.
// - getVoices() 가 처음엔 빈 배열일 수 있어 voiceschanged 를 구독한다
// - 해당 언어 목소리가 없으면 목소리 지정 없이 lang 만 주고 재생한다
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

/**
 * 그 언어 목소리가 하나라도 있는가. prefix 는 'en' | 'ko'.
 * 목소리 목록이 아직 안 왔으면(빈 배열) 낙관적으로 true
 */
export function hasVoice(prefix) {
  if (!canSpeak()) return false;
  if (voices.length === 0) refreshVoices();
  if (voices.length === 0) return true;
  const re = new RegExp('^' + prefix, 'i');
  return voices.some((v) => re.test(v.lang));
}

export function hasEnglishVoice() {
  return hasVoice('en');
}

function pickVoice(lang) {
  const exact = new RegExp('^' + lang.replace('-', '[-_]') + '$', 'i');
  const prefix = new RegExp('^' + lang.split('-')[0], 'i');
  return voices.find((v) => exact.test(v.lang)) || voices.find((v) => prefix.test(v.lang)) || null;
}

/**
 * 읽어준다. lang 기본은 영어. 이야기처럼 한국어 문장은 'ko-KR' 로.
 */
export function speak(text, rate = 0.8, lang = 'en-US') {
  if (!canSpeak()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    u.rate = rate;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
