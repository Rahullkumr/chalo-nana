// The family page's API: feelings -> settings -> route -> spoken plan -> saved for Nana -> walk log.
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { OLLAMA_MODEL } from '../config.js';
import { chatJSON } from '../services/ollama.js';
import { speakToBuffer, ttsEnabled } from '../services/elevenlabs.js';
import * as store from '../services/store.js';
import * as settingsPrompt from '../prompts/settings.js';
import * as speechPrompt from '../prompts/speech.js';
import { planLoop } from '../planner/loops.js';
import { keywordSignals, settingsFromSignals } from '../planner/settings.js';
import { nameRoute, routeSteps, templateSpeech, checkSpeech } from '../planner/describe.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

// The last 7 days against his daily goal, from the walk log only.
function weekSummary(walks, walker) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toLocaleDateString('en-CA');
    const those = walks.filter((w) => w.date === date);
    days.push({
      date,
      minutes: those.reduce((s, w) => s + (w.minutes || 0), 0),
      km: Math.round(those.reduce((s, w) => s + (w.km || 0), 0) * 100) / 100,
    });
  }
  const goal = walker.dailyGoalMinutes || null;
  return {
    goal,
    goalSource: walker.goalSource || null,
    days,
    daysMet: goal ? days.filter((d) => d.minutes >= goal).length : null,
    daysWalked: days.filter((d) => d.minutes > 0).length,
    km: Math.round(days.reduce((s, d) => s + d.km, 0) * 100) / 100,
  };
}

// Settings edited on the family page are clamped to his limits too.
function safeSettings(raw, walker) {
  return {
    maxMinutes: clamp(raw.maxMinutes, 5, walker.maxMinutes + 5),
    restEveryMinutes: clamp(raw.restEveryMinutes, 4, walker.restEveryMinutes + 5),
    restMinutes: clamp(raw.restMinutes, 2, 10),
    avoidUphill: ['no', 'prefer', 'never'].includes(raw.avoidUphill) ? raw.avoidUphill : 'prefer',
    preferShade: Boolean(raw.preferShade),
    pace: raw.pace === 'slow' ? 'slow' : 'normal',
    wantPlaces: (raw.wantPlaces || []).filter((k) => settingsPrompt.KINDS.includes(k)),
  };
}

export default async function apiRoutes(app) {
  app.get('/api/state', async () => {
    const [walker, places, todayPlan, walks] = await Promise.all([
      store.loadWalker(), store.loadPlaces(), store.loadToday(), store.loadWalks(),
    ]);
    return {
      walker, places, example: places.example, today: todayPlan, walks,
      week: weekSummary(walks, walker), tts: ttsEnabled, model: OLLAMA_MODEL,
    };
  });

  app.post('/api/settings', {
    schema: {
      body: {
        type: 'object',
        properties: {
          chips: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 20 },
          text: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (request) => {
    const { chips = [], text = '' } = request.body || {};
    const [walker, walks] = await Promise.all([store.loadWalker(), store.loadWalks()]);
    try {
      const { result, stats } = await chatJSON({
        system: settingsPrompt.system,
        user: settingsPrompt.buildUser({ chips, text: text.trim() }),
        schema: settingsPrompt.schema,
        options: { temperature: 0.1, num_predict: 300 },
      });
      request.log.info({ stats, signals: result }, 'signals from model');
      return { ...settingsFromSignals(result, walker, walks), signals: result, source: 'gemma', stats };
    } catch (err) {
      request.log.error(err, 'model failed, reading keywords instead');
      const signals = keywordSignals([...chips, text].join(' '));
      return { ...settingsFromSignals(signals, walker, walks), signals, source: 'default' };
    }
  });

  app.post('/api/plan', {
    schema: { body: { type: 'object', required: ['settings'], properties: { settings: { type: 'object' } } } },
  }, async (request) => {
    const [walker, map] = await Promise.all([store.loadWalker(), store.loadPlaces()]);
    const settings = safeSettings(request.body.settings, walker);
    const route = planLoop(map, settings, { speedMps: walker.speedMps });
    if (!route.ok) return { route, speech: '', speechSource: 'none', warnings: [route.reason] };

    const named = nameRoute(route, map);
    const warnings = route.fallback ? [route.reason] : [];
    const fallback = templateSpeech(named, walker);

    // Two tries at a warm, natural plan; if both mention a place not on the route, use the plain one.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { result, stats } = await chatJSON({
          system: speechPrompt.system,
          user: speechPrompt.buildUser({ walker, steps: routeSteps(named), settings }),
          schema: speechPrompt.schema,
          options: { temperature: attempt === 1 ? 0.5 : 0.3, num_predict: 1200 },
        });
        // Quote marks around names would be read aloud or make the voice pause oddly.
        const speech = result.speech.replace(/['"‘’“”]/g, '').replace(/\n{2,}/g, '\n').trim();
        const problems = checkSpeech(speech, named);
        request.log.info({ stats, attempt, problems }, 'speech from model');
        if (!problems.length) return { route: named, speech, speechSource: 'gemma', warnings, settings };
        warnings.push(`model attempt ${attempt}: ${problems.join(', ')}`);
      } catch (err) {
        request.log.error(err, 'speech model failed');
        warnings.push(`model attempt ${attempt} failed`);
        break;
      }
    }
    return { route: named, speech: fallback, speechSource: 'template', warnings, settings };
  });

  // Saves the plan for Nana's page and makes the MP3 once, so replaying it costs nothing
  // and still works if the internet drops.
  app.post('/api/today', {
    schema: {
      body: {
        type: 'object',
        required: ['speech', 'route'],
        properties: {
          speech: { type: 'string', minLength: 1, maxLength: 3000 },
          route: { type: 'object' },
          settings: { type: 'object' },
        },
      },
    },
  }, async (request) => {
    const { speech, route, settings } = request.body;
    let audio = false;
    if (ttsEnabled) {
      try {
        await store.saveTodayAudio(await speakToBuffer(speech));
        audio = true;
      } catch (err) {
        request.log.error(err, 'ElevenLabs failed, Nana page will use the local voice');
      }
    }
    await store.saveToday({ date: today(), speech, route, settings, audio, savedAt: new Date().toISOString() });
    return { saved: true, audio };
  });

  app.get('/api/today', async () => ({ plan: await store.loadToday() }));

  app.get('/today.mp3', async (request, reply) => {
    const plan = await store.loadToday();
    try {
      if (!plan?.audio) throw new Error('no audio');
      await access(store.todayAudioPath);
    } catch {
      return reply.code(404).send({ error: 'No audio for today yet.' });
    }
    return reply.type('audio/mpeg').header('Cache-Control', 'no-cache').send(createReadStream(store.todayAudioPath));
  });

  app.post('/api/walks', {
    schema: {
      body: {
        type: 'object',
        required: ['minutes'],
        properties: {
          steps: { type: 'number', minimum: 0, maximum: 50000 },
          minutes: { type: 'number', minimum: 0, maximum: 300 },
          rests: { type: 'number', minimum: 0, maximum: 50 },
          restMinutes: { type: 'number', minimum: 0, maximum: 300 },
          felt: { type: 'string', enum: ['good', 'okay', 'tired', 'pain'] },
          completed: { type: 'boolean' },
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request) => {
    const walker = await store.loadWalker();
    const b = request.body;
    const walk = {
      date: today(),
      loggedAt: new Date().toISOString(),
      steps: b.steps ?? null,
      // Distance from his phone's step count and his stride; never from the plan's estimate.
      km: b.steps ? Math.round((b.steps * walker.strideM) / 10) / 100 : null,
      minutes: b.minutes,
      rests: b.rests ?? 0,
      restMinutes: b.restMinutes ?? null,
      felt: b.felt ?? 'okay',
      completed: b.completed ?? true,
      note: b.note ?? '',
    };
    const walks = await store.addWalk(walk);
    return { walk, walks, week: weekSummary(walks, walker) };
  });
}
