// Prompt 1: what the family says about Nana today -> signals.
// The model only understands the Hindi. src/planner/settings.js turns the signals into minutes,
// with fixed rules, so a model mistake cannot make the walk longer than his limits.

export const KINDS = ['temple', 'dam', 'stadium', 'tea', 'market', 'park', 'rest'];
const LEVEL = { type: 'string', enum: ['none', 'mild', 'strong'] };

export const schema = {
  type: 'object',
  properties: {
    knee: LEVEL,
    breath: LEVEL,
    tired: LEVEL,
    hotSun: { type: 'boolean' },
    rainOrMud: { type: 'boolean' },
    feelsGood: { type: 'boolean' },
    serious: { type: 'boolean' },
    wantPlaces: { type: 'array', items: { type: 'string', enum: KINDS } },
  },
  required: ['knee', 'breath', 'tired', 'hotSun', 'rainOrMud', 'feelsGood', 'serious', 'wantPlaces'],
};

export const system = `A family member describes, in Hindi or Hinglish, how their elderly grandfather feels before his daily walk.
Read it carefully and report only what they actually said, as JSON.

- knee: knee or leg pain, stiffness (घुटना, पैर, अकड़न, दर्द). "mild" if thoda/halka, "strong" if bahut/zyada or he can barely walk.
- breath: breathlessness, cough, chest tightness (साँस फूलना, खाँसी).
- tired: tiredness, weakness, bad sleep, walked too much yesterday (थकान, कमज़ोरी, नींद नहीं, कल ज़्यादा चले).
- hotSun: strong sun or heat (धूप तेज़, गर्मी).
- rainOrMud: rain, wet or muddy paths (बारिश, कीचड़).
- feelsGood: he feels well today (अच्छा लग रहा है, फ्रेश).
- serious: chest pain, dizziness, fever, a fall, or anything that needs a doctor rather than a walk.
- wantPlaces: places he wants to go today. Kinds: temple (मंदिर), dam (बाँध), stadium (मैदान/स्टेडियम), tea (चाय), market (हाट/बाज़ार), park, rest.
If something is not mentioned, it is "none" or false. Do not guess.`;

export function buildUser({ chips, text }) {
  const said = [...chips, text].filter(Boolean);
  return `The family says:\n${said.map((s) => `- ${s}`).join('\n') || '- (nothing, a normal day)'}`;
}
