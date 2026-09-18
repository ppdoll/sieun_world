// src/api.js
// 서버 함수(/api/*) 호출. API 키는 서버에만 있고 여기서는 절대 다루지 않는다.

const PASSCODE_KEY = 'wordlab:passcode';

export function getPasscode() {
  try {
    return localStorage.getItem(PASSCODE_KEY) || '';
  } catch {
    return '';
  }
}
export function setPasscode(code) {
  try {
    if (code) localStorage.setItem(PASSCODE_KEY, code);
    else localStorage.removeItem(PASSCODE_KEY);
  } catch {
    /* 저장 못 해도 이번 세션은 진행 */
  }
}

export class ApiError extends Error {
  constructor(message, { status, needPasscode = false, disabled = false } = {}) {
    super(message);
    this.status = status;
    this.needPasscode = needPasscode;
    this.disabled = disabled; // 서버에 그 기능이 꺼져 있음 (예: GITHUB_TOKEN 없음)
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-passcode': getPasscode() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('인터넷이 연결되어 있는지 확인하고 다시 눌러주세요.', { status: 0 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(data?.error || '잘 되지 않았어요. 한 번 더 눌러주세요.', {
      status: res.status,
      needPasscode: !!data?.needPasscode,
      disabled: !!data?.disabled,
    });
  }
  return data;
}

const post = (path, body) => request('POST', path, body);

/**
 * 사진을 서버로 보내기 전에 줄인다.
 * - 긴 변 1600px, JPEG 0.85 → 대개 300~600KB. Vercel 본문 한도(4.5MB)와 토큰 비용 모두를 위해서다
 * - 디코드가 안 되는 형식(일부 HEIC)은 원본을 그대로 보낸다
 * @returns {Promise<{data: string, mediaType: string}>}
 */
export async function prepareImage(file, { maxSide = 1600, quality = 0.85 } = {}) {
  const original = await fileToDataUrl(file);
  const originalMime = file.type || 'image/jpeg';
  try {
    const img = await loadImage(original);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } catch {
    return { data: original.split(',')[1], mediaType: originalMime };
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('사진을 읽지 못했어요'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

/** 사진 한 장 → { words, status, split } */
export function extractFromImage(image) {
  return post('/api/extract', { image });
}

/** 단어 목록 → { phonics, status } */
export function extractPhonics(words) {
  return post('/api/extract/phonics', { words });
}

/** 단어 목록 → { story, status, used }. story 가 '' 이면 만들지 못한 것 */
export function extractStory(words) {
  return post('/api/extract/story', { words });
}

/* ── 독해 ── */

/** 지문 사진 1장 → { title, passage, sentences, questions, status } */
export function extractPassage(image) {
  return post('/api/extract/passage', { image });
}

/**
 * 지문 텍스트 → { questions, status }. 사진을 다시 읽지 않으므로
 * "문제 다시 만들기" 를 눌러도 지문 분석 비용이 들지 않는다.
 */
export function makeQuestions(passage, avoid = []) {
  return post('/api/extract/questions', { passage, avoid });
}

/**
 * 지문 문장들 → { translations }. 문장 수와 길이가 같고, 못 받은 자리는 빈 문자열.
 * 번역이 맞는지는 확인할 수 없지만 어느 문장의 번역인지는 서버가 대조해서 넣는다.
 */
export function translateSentences(sentences) {
  return post('/api/extract/translate', { sentences });
}

/* ── 공유 저장 (git data 브랜치, 최근 5개). 다른 기기와 단어장을 나눈다 ── */

/** → { sets, disabled? } */
export function fetchRemoteSets() {
  return request('GET', '/api/wordsets');
}

/** 단어장 올리기(같은 id 면 교체) → { sets } */
export function pushRemoteSet(set) {
  return post('/api/wordsets', { set });
}

/** 단어장 지우기 → { sets } */
export function deleteRemoteSet(id) {
  return request('DELETE', '/api/wordsets?id=' + encodeURIComponent(id));
}
