import { TEXT } from './i18n.js';

// Read aloud. First choice: ElevenLabs voice via our server (POST /speak).
// Fallback: a voice installed on this device. Online browser voices (localService false)
// are skipped because they would send the text to a cloud service without saying so.
const canSpeak = 'speechSynthesis' in window;
let ttsOnline = false;
let audio = null;
let abort = null;
let cached = { text: '', url: '' }; // replaying the same text costs no extra credits
let ui = null; // { button, label, getText, getLang, onNote }

export function pickVoice(lang = 'hi') {
  if (!canSpeak) return null;
  const local = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith(lang));
  return local.find((v) => /-in$/i.test(v.lang)) || local[0] || null;
}

function setIdle() {
  ui.button.classList.remove('speaking');
  ui.label.textContent = TEXT[ui.getLang()].listen;
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
  abort?.abort();
  abort = null;
  audio?.pause();
  audio = null;
  if (ui) setIdle();
}

async function speakOnline(text) {
  if (cached.text !== text) {
    abort = new AbortController();
    const res = await fetch('/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`speak failed: ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    if (cached.url) URL.revokeObjectURL(cached.url);
    cached = { text, url };
  }
  audio = new Audio(cached.url);
  audio.onended = stopSpeaking;
  await audio.play();
  ui.label.textContent = TEXT[ui.getLang()].stop;
}

function speakLocal(voice, text) {
  // One utterance per sentence: browsers can cut off a single long utterance part-way.
  const sentences = text.split(/(?<=[।.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  speechSynthesis.cancel();
  sentences.forEach((sentence, i) => {
    const u = new SpeechSynthesisUtterance(sentence);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    if (i === sentences.length - 1) u.onend = stopSpeaking;
    speechSynthesis.speak(u);
  });
}

async function speakNow() {
  const text = ui.getText().trim();
  if (!text) return;
  const t = TEXT[ui.getLang()];
  ui.onNote('');
  ui.button.classList.add('speaking');
  ui.label.textContent = ttsOnline ? t.preparing : t.stop;
  if (ttsOnline) {
    try {
      await speakOnline(text);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Service failed or offline: fall through to the local voice.
    }
  }
  const voice = pickVoice('hi');
  if (voice) {
    ui.label.textContent = t.stop;
    speakLocal(voice, text);
  } else {
    setIdle();
    ui.onNote(t.noVoice);
  }
}

export function initSpeech(opts) {
  ui = opts;
  fetch('/config').then((r) => r.json()).then((c) => { ttsOnline = Boolean(c.tts); }).catch(() => {});
  ui.button.addEventListener('click', () => {
    if (ui.button.classList.contains('speaking')) stopSpeaking();
    else speakNow();
  });
}
