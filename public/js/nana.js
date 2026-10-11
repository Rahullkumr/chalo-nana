// Nana's page: one button. Plays /today.mp3, falls back to a local Hindi voice reading the saved text.
const $ = (id) => document.getElementById(id);
const LABEL_PLAY = '▶ आज की सैर सुनिए';
const LABEL_STOP = '■ रोकिए';
const NOT_READY = 'आज की सैर अभी तैयार नहीं है';
const canSpeak = 'speechSynthesis' in window;

let audio = null;
let playing = false;
let token = 0; // invalidates callbacks from a cancelled run

function localVoice() {
  if (!canSpeak) return null;
  const local = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith('hi'));
  return local.find((v) => /-in$/i.test(v.lang)) || local[0] || null;
}

function setPlaying(on) {
  playing = on;
  $('play').textContent = on ? LABEL_STOP : LABEL_PLAY;
  $('play').classList.toggle('playing', on);
}

function stopAll() {
  token++;
  audio?.pause();
  audio = null;
  if (canSpeak) speechSynthesis.cancel();
  setPlaying(false);
}

function finished() {
  setPlaying(false);
  $('play').hidden = true;
  $('done').hidden = false;
  $('again').hidden = false;
}

function speakLocal(text, my) {
  const voice = localVoice();
  if (!voice) { setPlaying(false); $('msg').textContent = NOT_READY; $('msg').hidden = false; return; }
  // One utterance per sentence: browsers can cut off a single long utterance part-way.
  const sentences = text.split(/(?<=[।.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  speechSynthesis.cancel();
  sentences.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    if (i === sentences.length - 1) u.onend = () => { if (my === token) finished(); };
    speechSynthesis.speak(u);
  });
}

async function start() {
  const my = ++token;
  $('msg').hidden = true;
  $('done').hidden = true;
  $('again').hidden = true;
  $('play').hidden = false;
  setPlaying(true);
  try {
    const a = new Audio('/today.mp3');
    audio = a;
    a.onended = () => { if (my === token) finished(); };
    await a.play(); // rejects when the file is missing (404) or cannot be decoded
    return;
  } catch {
    if (my !== token) return;
    audio = null;
  }
  let plan = null;
  try {
    plan = (await (await fetch('/api/today')).json()).plan;
  } catch { /* offline */ }
  if (my !== token) return;
  if (!plan || !plan.speech) {
    setPlaying(false);
    $('msg').textContent = NOT_READY;
    $('msg').hidden = false;
    if (localVoice()) speakLocal(NOT_READY, -1); // -1: never show the "walk now" ending
    return;
  }
  speakLocal(plan.speech, my);
}

$('play').addEventListener('click', () => { if (playing) stopAll(); else start(); });
$('again').addEventListener('click', start);
if (canSpeak) speechSynthesis.getVoices(); // nudge the browser to load voices early
