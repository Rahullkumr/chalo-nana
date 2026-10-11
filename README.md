![Hacktoberfest 2026 Open-Source AI Challenge Week 1: Touch Grass](docs/images/banner.png)

# Chalo Nana · चलो नाना

**A daily walk for my grandfather, planned on a laptop, spoken to him in Hindi, and then the phone goes in his pocket.**

My Nana's doctor told him to walk at least 30 minutes a day. He can walk. What he doesn't have is a reason to put the reels down at five in the evening. Chalo Nana gives him one: every day a family member taps how he is feeling, a local Gemma model and some plain code turn that into a walk sized for him, through the places he likes and to whatever is happening there today, and he hears it once in a warm Hindi voice. Then the screen is done.

Built for DEV's [Hacktoberfest Open-Source AI Challenge, Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05). It follows [Padh Ke Batao](https://github.com/Rahullkumr/padh-ke-batao), which I built for the same Nana in the previous round.

| Family page (30 seconds a day) | Nana's page (one button) |
|---|---|
| ![Step 1: how is Nana today](docs/images/step1-how-is-nana.png) | ![Nana's one big button](docs/images/nana-button.png) |

![Step 2: today's walk, with the route and the Hindi plan](docs/images/step2-todays-walk.png)

Screenshots use the made-up example village in `examples/`, never the real map.

## How it works

1. **The family says how he is.** Pills in Hindi (घुटने में दर्द है, धूप तेज़ है, आज बाज़ार हो आए हैं, the places he wants to go) or a line in their own words.
2. **Gemma reads it.** A local `gemma4:e4b` in Ollama turns the Hindi into signals (knee: mild, already walked today: a lot, wants: the pandal) through a JSON schema. It does not pick the minutes.
3. **Code decides the limits.** Fixed rules in [`src/planner/settings.js`](src/planner/settings.js) turn signals into today's settings, clamped to his profile, so a model mistake can never make the walk longer or harder than the family set. Yesterday counts too: after a tiring walk, today is shorter.
4. **Code picks the route.** [`src/planner/loops.js`](src/planner/loops.js) searches every loop from home back to home over the family's place map, never uses a link marked highway, puts a seat every N minutes, and prefers places he likes, places he asked for and places that are lively right now. If nothing fits, it says so and offers a short walk to the nearest bench.
5. **Gemma writes what a grandson would say.** Simple Hindi, Devanagari only, landmarks not street names, opening with what is happening today. [`src/planner/describe.js`](src/planner/describe.js) rejects any plan that mentions a place not on the route and falls back to a plainer plan written by code.
6. **ElevenLabs says it.** The plan text, and only the text, becomes one MP3 a day in an Indian-accent Hindi voice. It is saved on the laptop, so replays are free and work without internet. If ElevenLabs is unreachable, the phone's own Hindi voice reads it.
7. **After the walk** the family logs steps, minutes, rests and how he felt. The weekly line shows the doctor's goal against real walks.

```
family pills / Hindi text ──► Gemma (signals, JSON) ──► rules (settings) ──► loop search (place map)
                                                                                    │
            Nana's phone ◄── today.mp3 ◄── ElevenLabs ◄── place check ◄── Gemma (Hindi plan)
```

### Why a place map and not OpenStreetMap streets

The first version downloaded the area around his home from OpenStreetMap ([`scripts/fetch-area.js`](scripts/fetch-area.js), still in the repo for towns that are mapped). For his village it returned ten road segments, nine of them the national highway, the one road he should never walk on, and fourteen ponds. No lanes, no temple, no stadium. So the family drew the map in the way villages give directions: places, and the minutes between them at his pace, timed on a real walk. That file is `data/places.json`; see [`examples/places.example.json`](examples/places.example.json) for the format.

## Run it

Needs Node 22.9+, [Ollama](https://ollama.com) and about 7 GB free for the model. Runs on a CPU; built on an i7 laptop with no GPU (about 9 s to read the Hindi, 25 s to write the plan).

```bash
ollama pull gemma4:e4b
npm install
cp .env.example .env        # add ELEVENLABS_API_KEY; HOST=0.0.0.0 to open it from a phone on the same Wi-Fi
npm start
```

- Family page: http://localhost:3000
- Nana's page: http://<laptop-ip>:3000/nana.html

It starts with the example village. To make it yours:

1. Copy `examples/walker.example.json` to `data/walker.json`: name, how long they can walk, how often they sit, the doctor's daily goal.
2. Copy `examples/places.example.json` to `data/places.json`: the places they like, where they can sit, which days or hours each place is lively, and the minutes between places at their pace. Mark any link that goes along a main road as `"highway": true`.
3. Optional: if your area is well mapped, `npm run fetch-area` downloads the streets once (it sends a rounded area, not your house).

`npm run plan -- 30 10 --slow --no-uphill` prints a plan without the model, to check a map.

## Privacy

Everything private stays in `data/` and `.env`, which git ignores: home coordinates, the place map, the walk log. Gemma runs on the laptop. The only thing that leaves is the day's plan text, to ElevenLabs. No account, no server, no tracking.

## Stack

Node 22, Fastify 5, plain HTML/CSS/JS (no build step), Ollama with `gemma4:e4b`, ElevenLabs `eleven_multilingual_v2`. One runtime dependency.

## License

MIT
