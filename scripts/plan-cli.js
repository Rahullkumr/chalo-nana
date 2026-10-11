// Plans a walk from the command line, without the model, to check the planner.
// Usage: npm run plan -- [maxMinutes] [restEvery] [--slow] [--shade] [--no-uphill]
import { loadPlaces, loadWalker } from '../src/services/store.js';
import { planLoop } from '../src/planner/loops.js';

const [maxArg, restArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f) => process.argv.includes(f);

const map = await loadPlaces();
const walker = await loadWalker();
const settings = {
  maxMinutes: Number(maxArg) || walker.maxMinutes,
  restEveryMinutes: Number(restArg) || walker.restEveryMinutes,
  restMinutes: walker.restMinutes,
  avoidUphill: flag('--no-uphill') ? 'never' : 'prefer',
  preferShade: flag('--shade'),
  pace: flag('--slow') ? 'slow' : 'normal',
  wantPlaces: walker.likes,
};

const name = Object.fromEntries(map.places.map((p) => [p.id, p.name]));
const route = planLoop(map, settings, { speedMps: walker.speedMps });
console.log(map.example ? '(example village)' : '(your place map)', settings);
if (!route.ok) {
  console.log('No walk fits:', route.reason);
  process.exit(0);
}
console.log(`${route.candidates} loops checked${route.fallback ? `, FALLBACK: ${route.reason}` : ''}`);
for (const leg of route.legs) {
  console.log(`  ${name[leg.from]} -> ${name[leg.to]}  ${leg.minutes} min${leg.uphill ? ' uphill' : ''}${leg.shade ? ' shade' : ''}${leg.standingPauses ? ` (${leg.standingPauses} standing pause)` : ''}`);
}
for (const s of route.stops) {
  console.log(`  stop ${name[s.at]} after ${s.afterMinutes} min: ${s.restMinutes ? `sit ${s.restMinutes} min on ${s.sit}` : 'pass by'}`);
}
console.log(`walk ${route.walkMinutes} min + rest ${route.restMinutes} min = ${route.totalMinutes} min, ~${route.estimatedKm} km (estimate)`);
