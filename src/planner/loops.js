// Finds today's walk: a loop from home back to home over the family's place map.
//
// The place map is a small graph. Places are nodes (home, temple, dam, a bench...).
// Links are walks between two places, with the time it takes Nana and a few flags.
// The model never picks the route; it only sets the limits (settings) this code obeys.

// One edge may be walked at most twice (there and back). Deeper searches add nothing
// for a walk of under an hour in a village.
const MAX_LINKS = 10;
const MAX_LINK_USES = 2;

const isOpen = (place, now) => {
  if (place.days?.length && !place.days.includes(now.getDay())) return false;
  if (place.hours) {
    const h = now.getHours() + now.getMinutes() / 60;
    if (h < place.hours.from || h > place.hours.to) return false;
  }
  return true;
};

const canSit = (place) => Boolean(place.sit);

// Every loop from home that fits the time limit and never uses a link the settings forbid.
function enumerateLoops(map, settings, slowFactor) {
  const adj = new Map(map.places.map((p) => [p.id, []]));
  map.links.forEach((link, i) => {
    if (link.highway) return; // never, whatever the settings say
    if (link.uphill && settings.avoidUphill === 'never') return;
    adj.get(link.a)?.push({ to: link.b, i });
    adj.get(link.b)?.push({ to: link.a, i });
  });

  const limit = settings.maxMinutes * 1.1;
  const loops = [];
  const uses = new Map();
  const path = [];

  (function walk(at, minutes) {
    if (path.length && at === 'home') {
      loops.push({ links: [...path], minutes });
      return; // a loop ends the first time it gets home
    }
    if (path.length >= MAX_LINKS) return;
    for (const { to, i } of adj.get(at) || []) {
      const link = map.links[i];
      const m = link.minutes * slowFactor;
      const used = uses.get(i) || 0;
      if (used >= MAX_LINK_USES || minutes + m > limit) continue;
      uses.set(i, used + 1);
      path.push({ i, from: at, to });
      walk(to, minutes + m);
      path.pop();
      uses.set(i, used);
    }
  })('home', 0);
  return loops;
}

// Turns a loop into stops with rests, and scores how well it fits today.
function evaluate(loop, map, settings, slowFactor, now) {
  const byId = new Map(map.places.map((p) => [p.id, p]));
  const legs = [];
  const stops = [];
  const notes = [];
  let score = 0;
  let sinceRest = 0;
  let walked = 0;
  const visited = new Set();
  const reused = new Set();
  const seenLinks = new Set();

  for (const step of loop.links) {
    const link = map.links[step.i];
    const minutes = Math.round(link.minutes * slowFactor * 10) / 10;
    if (seenLinks.has(step.i)) reused.add(step.i);
    seenLinks.add(step.i);

    // A long link with nowhere to sit gets a standing pause in the middle.
    const pauses = Math.floor((sinceRest + minutes) / (settings.restEveryMinutes * 1.25));
    legs.push({
      from: step.from,
      to: step.to,
      minutes,
      uphill: Boolean(link.uphill),
      shade: Boolean(link.shade),
      standingPauses: pauses,
    });
    walked += minutes;
    sinceRest += minutes;
    if (pauses) {
      score -= pauses * 4;
      sinceRest = (sinceRest) % (settings.restEveryMinutes * 1.25);
    }
    if (link.uphill && settings.avoidUphill === 'prefer') score -= 8;
    if (settings.preferShade && !link.shade) score -= minutes * 0.4;

    const place = byId.get(step.to);
    if (step.to === 'home') break;

    const open = isOpen(place, now);
    const firstVisit = !visited.has(place.id);
    visited.add(place.id);
    if (firstVisit && open) {
      score += (place.likes || 0) * 6;
      if (settings.wantPlaces?.includes(place.kind)) score += 10;
    }

    // Sit here if he has walked most of a rest interval, or a little less at a place he loves.
    const due = sinceRest / settings.restEveryMinutes;
    if (canSit(place) && (due >= 0.75 || (firstVisit && place.likes >= 2 && due >= 0.5))) {
      stops.push({ at: place.id, afterMinutes: Math.round(walked), restMinutes: settings.restMinutes, sit: place.sit });
      score -= Math.max(0, sinceRest - settings.restEveryMinutes) * 3;
      sinceRest = 0;
    } else if (firstVisit) {
      stops.push({ at: place.id, afterMinutes: Math.round(walked), restMinutes: 0, sit: null, open });
    }
  }
  score -= Math.max(0, sinceRest - settings.restEveryMinutes) * 3;

  // Close to the time he can manage today, but under is much better than over.
  const target = settings.maxMinutes * 0.9;
  const diff = walked - target;
  score -= diff > 0 ? diff * 4 : -diff * 1.2;
  score -= reused.size * 1.5; // out-and-back is fine, a loop is a little nicer

  if (reused.size) notes.push('same_way_back');
  return { legs, stops, walkMinutes: Math.round(walked), score };
}

// settings: { maxMinutes, restEveryMinutes, restMinutes, avoidUphill: 'no'|'prefer'|'never',
//             preferShade, wantPlaces: [kind], pace: 'normal'|'slow' }
// Returns the best route, or { ok: false, reason } with a shorter fallback when nothing fits.
export function planLoop(map, settings, { now = new Date(), speedMps = 0.75 } = {}) {
  const slowFactor = settings.pace === 'slow' ? 1.15 : 1;
  const loops = enumerateLoops(map, settings, slowFactor);
  const ranked = loops
    .map((loop) => evaluate(loop, map, settings, slowFactor, now))
    .sort((a, b) => b.score - a.score);

  const finish = (route, extra = {}) => {
    const restMinutes = route.stops.reduce((s, x) => s + x.restMinutes, 0);
    return {
      ok: true,
      ...route,
      restMinutes,
      totalMinutes: route.walkMinutes + restMinutes,
      // An estimate from the family's minutes. The real distance comes from his step count.
      estimatedKm: Math.round((route.walkMinutes * 60 * speedMps) / 100) / 10,
      candidates: ranked.length,
      ...extra,
    };
  };

  const best = ranked[0];
  if (best && best.walkMinutes >= settings.maxMinutes * 0.5) return finish(best);

  // Nothing near today's limit: the shortest walk to somewhere he can sit, and back.
  const sitLinks = map.links
    .filter((l) => !l.highway && (l.a === 'home' || l.b === 'home'))
    .map((l) => ({ l, other: map.places.find((p) => p.id === (l.a === 'home' ? l.b : l.a)) }))
    .filter(({ other }) => other && canSit(other))
    .sort((x, y) => x.l.minutes - y.l.minutes);
  if (!sitLinks.length) {
    return { ok: false, reason: 'no_walk_fits', candidates: ranked.length };
  }
  const { l, other } = sitLinks[0];
  const m = Math.round(l.minutes * slowFactor);
  return finish({
    legs: [
      { from: 'home', to: other.id, minutes: m, uphill: Boolean(l.uphill), shade: Boolean(l.shade), standingPauses: 0 },
      { from: other.id, to: 'home', minutes: m, uphill: Boolean(l.uphill), shade: Boolean(l.shade), standingPauses: 0 },
    ],
    stops: [{ at: other.id, afterMinutes: m, restMinutes: settings.restMinutes, sit: other.sit }],
    walkMinutes: m * 2,
    score: 0,
  }, { fallback: true, reason: best ? 'only_short_walks' : 'no_loop_fits' });
}
