// Signals about today (from the model, or from simple keywords) -> walk settings.
// Fixed rules, so the walk is never longer or harder than the family's limits for him.
import { KINDS } from '../prompts/settings.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const SHORTER = { none: 1, mild: 0.85, strong: 0.65 };
const SHORTER_BREATH = { none: 1, mild: 0.7, strong: 0.5 };
const ALREADY_WALKED = { none: 1, mild: 0.7, strong: 0.5 };
const REST_SOONER = { none: 0, mild: 2, strong: 4 };

// Used when the model is unavailable.
export function keywordSignals(said) {
  const has = (re) => re.test(said);
  const level = (re) => (has(re) ? (has(/बहुत|ज़्यादा|ज्यादा|bahut|zyada/i) ? 'strong' : 'mild') : 'none');
  return {
    knee: level(/घुटन|पैर|अकड़|दर्द|ghutn|dard|pain/i),
    breath: level(/साँस|सांस|खाँसी|saans|breath|cough/i),
    tired: level(/थक|कमज़ोर|नींद|thak|tired/i),
    walkedToday: level(/(बाज़ार|बाजार|हाट|सुबह).*(गए|आए|चल)|(bazaar|haat|subah).*(gaye|aaye|chal)/i),
    hotSun: has(/धूप|गर्मी|dhoop|garmi|sun|hot/i),
    rainOrMud: has(/बारिश|कीचड़|baarish|keechad|rain|mud/i),
    feelsGood: has(/अच्छा|achha|accha|good/i),
    serious: has(/सीने|चक्कर|बुखार|गिर|chakkar|bukhar|fever|dizzy|chest/i),
    wantPlaces: [
      has(/मंदिर|mandir|temple/i) && 'temple',
      has(/बाँध|बांध|baandh|bandh|dam/i) && 'dam',
      has(/मैदान|स्टेडियम|maidan|stadium/i) && 'stadium',
      has(/चाय|chai|tea/i) && 'tea',
      has(/(हाट|बाज़ार|बाजार|haat|bazaar|market).*(जाना|jaana|chalna)/i) && 'market',
      has(/बगीचा|बगीचे|पार्क|bagicha|park/i) && 'park',
      has(/होटल|मिठाई|पेंशन|hotel|mithai|pension/i) && 'hotel',
      has(/दोस्त|अर्जुन|dost|arjun|friend/i) && 'friend',
    ].filter(Boolean),
  };
}

// Returns { settings, reasonHi, skipToday }.
export function settingsFromSignals(s, walker, walks = []) {
  const last = walks.at(-1);
  let minutes = walker.maxMinutes
    * Math.min(SHORTER[s.knee] ?? 1, SHORTER[s.tired] ?? 1, SHORTER_BREATH[s.breath] ?? 1)
    * (s.hotSun ? 0.9 : 1)
    * (s.rainOrMud ? 0.8 : 1)
    * (ALREADY_WALKED[s.walkedToday] ?? 1);
  const reasons = [];
  if (s.walkedToday && s.walkedToday !== 'none') reasons.push('आज पहले ही चल चुके हैं, इसलिए छोटी सैर');

  // Yesterday decides too: after a hard walk, go shorter than that walk; after a good one, a little more.
  // Walking time only: an hour out with twenty minutes of chatting on the stadium stairs is not an hour's walk.
  const lastWalking = last ? last.minutes - (last.restMinutes ?? (last.rests || 0) * 5) : 0;
  if (last && (last.felt === 'tired' || last.felt === 'pain' || !last.completed)) {
    minutes = Math.min(minutes, lastWalking * 0.85);
    reasons.push('पिछली सैर के बाद थकान थी, इसलिए आज छोटी सैर');
  } else if (last && last.felt === 'good' && s.feelsGood && minutes >= walker.maxMinutes) {
    minutes = Math.min(walker.maxMinutes + 5, lastWalking + 5);
    reasons.push('पिछली सैर अच्छी रही, आज पाँच मिनट ज़्यादा');
  }

  const restSooner = Math.max(REST_SOONER[s.knee] ?? 0, REST_SOONER[s.breath] ?? 0, s.tired === 'strong' ? 2 : 0);
  if (s.knee !== 'none') reasons.push('घुटने में दर्द है, इसलिए चढ़ाई नहीं और धीमी चाल');
  if (s.breath !== 'none') reasons.push('साँस फूल रही है, इसलिए धीरे और कम');
  if (s.tired !== 'none') reasons.push('थकान है, इसलिए थोड़ी छोटी सैर');
  if (s.hotSun) reasons.push('धूप तेज़ है, छाँव वाला रास्ता');
  if (s.rainOrMud) reasons.push('रास्ते गीले हैं, छोटी सैर');
  if (!reasons.length) reasons.push(s.feelsGood ? 'आज अच्छा लग रहा है, रोज़ जैसी सैर' : 'रोज़ जैसी सैर');
  // The daily goal (often the doctor's "30 minutes a day") never overrides a bad day; it is said plainly.
  if (walker.dailyGoalMinutes && minutes < walker.dailyGoalMinutes) {
    reasons.push(`आज रोज़ के लक्ष्य (${walker.dailyGoalMinutes} मिनट) से कम, सेहत पहले`);
  }

  const wanted = (s.wantPlaces || []).filter((k) => KINDS.includes(k));
  return {
    settings: {
      maxMinutes: clamp(minutes, 5, walker.maxMinutes + 5),
      restEveryMinutes: clamp(walker.restEveryMinutes - restSooner, 4, walker.restEveryMinutes),
      restMinutes: clamp(walker.restMinutes + (restSooner ? 1 : 0), 2, 10),
      avoidUphill: s.knee !== 'none' || s.breath !== 'none' ? 'never' : s.rainOrMud ? 'prefer' : 'no',
      preferShade: Boolean(s.hotSun),
      pace: s.knee !== 'none' || s.breath !== 'none' || s.tired !== 'none' ? 'slow' : 'normal',
      // Only what was asked for today; places he usually likes already score through place.likes.
      wantPlaces: wanted,
    },
    mood: s.serious ? 'unwell' : s.breath === 'strong' || s.knee === 'strong' ? 'tired' : s.feelsGood ? 'good' : 'okay',
    reasonHi: reasons.join('। ') + '।',
    skipToday: Boolean(s.serious || s.breath === 'strong'),
  };
}
