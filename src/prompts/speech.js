// Prompt 2: the planned route -> what a grandchild would tell Nana before he leaves.
// The model only rewords the steps it is given; src/planner/describe.js checks it invented nothing.

export const schema = {
  type: 'object',
  properties: { speech: { type: 'string' } },
  required: ['speech'],
};

// Hindi verbs follow the speaker's gender ("बताती हूँ" / "बताता हूँ"), so the speaker must match
// the ElevenLabs voice. Set walker.speaker to "granddaughter" or "grandson".
const SPEAKERS = {
  granddaughter: 'a loving granddaughter. You are female: use feminine first-person verbs (मैं बताती हूँ, मैंने सोचा है).',
  grandson: 'a loving grandson. You are male: use masculine first-person verbs (मैं बताता हूँ, मैंने सोचा है).',
};

export function systemFor(walker) {
  return `You are ${SPEAKERS[walker.speaker] || SPEAKERS.grandson}
You are explaining today's walk to your grandfather (Nana) before he leaves home.
Write what you would say, in simple spoken Hindi, Devanagari script only (no English words, no Latin letters, no digits: write numbers as Hindi words like "पाँच").

Rules:
- If the steps start with "Today at ...", open with that in one warm sentence, as the reason to go out today. Then the walk.
- Follow the steps in order. Mention only the places in the steps, by the exact names given, without quote marks. Do not add any other place, road, shop, temple, tree or landmark.
- Use places, not directions. Say how many minutes each part takes and where to sit and for how long.
- He walks; you stay home. Speak to him (आप चलिए, आप बैठिए), never "हम चलेंगे".
- Warm and respectful (आप, नानाजी). Short sentences, 8 to 14 sentences in total.
- If a step says "standing pause", tell him to stop and breathe for a minute there.
- End by telling him to keep the phone in his pocket and come home slowly, there is no hurry.`;
}

export function buildUser({ walker, steps, settings }) {
  return `Call him: ${walker.callName || walker.name}
Today: ${settings.pace === 'slow' ? 'walk slowly today' : 'normal pace'}${settings.preferShade ? ', it is sunny, stay in the shade' : ''}.

Steps:
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
