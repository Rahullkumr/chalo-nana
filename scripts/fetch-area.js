// One-time download of the neighbourhood from OpenStreetMap (Overpass API).
// Saves data/area.json; daily planning then runs offline from that file.
//
// Privacy: the request does not contain the house. The centre is rounded to a ~1 km grid
// and the radius grown to cover it, so Overpass only sees "a few km around this part of town".
//
// Usage: npm run fetch-area            (uses HOME_LAT / HOME_LON / AREA_RADIUS_M from .env)
//        npm run fetch-area -- --force (re-download even if data/area.json exists)
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { HOME_LAT, HOME_LON, AREA_RADIUS_M, DATA_DIR } from '../src/config.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

if (!Number.isFinite(HOME_LAT) || !Number.isFinite(HOME_LON)) {
  console.error('Set HOME_LAT and HOME_LON in .env first (long-press the house in Google Maps).');
  process.exit(1);
}

const out = join(DATA_DIR, 'area.json');
if (!process.argv.includes('--force')) {
  try {
    await access(out);
    console.log(`${out} already exists. Use --force to download again.`);
    process.exit(0);
  } catch {}
}

const lat = Math.round(HOME_LAT * 100) / 100;
const lon = Math.round(HOME_LON * 100) / 100;
const radius = AREA_RADIUS_M + 800; // covers the rounding (up to ~780 m at this latitude)
const A = `(around:${radius},${lat},${lon})`;

// Streets a person can walk on. Busy roads come too, so the planner knows where they are
// and can avoid them; it never routes along them.
const query = `
[out:json][timeout:90];
(
  way["highway"~"^(footway|path|pedestrian|living_street|residential|service|unclassified|tertiary|tertiary_link|track|steps|primary|primary_link|secondary|secondary_link|trunk|trunk_link|road)$"]${A};
)->.roads;
(
  nwr["amenity"~"^(bench|place_of_worship|drinking_water|shelter|cafe|fast_food|restaurant|marketplace|toilets)$"]${A};
  nwr["leisure"~"^(park|garden|stadium|pitch|sports_centre|playground)$"]${A};
  nwr["shop"]${A};
  nwr["waterway"~"^(dam|weir)$"]${A};
  nwr["natural"="water"]${A};
  nwr["water"~"^(reservoir|lake|pond)$"]${A};
  node["natural"="tree"]${A};
)->.places;
.roads out body geom;
.places out tags center;
`;

async function download() {
  for (const url of ENDPOINTS) {
    try {
      console.log(`Asking ${new URL(url).host} for ~${(radius / 1000).toFixed(1)} km around (${lat}, ${lon})...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'chalo-nana/1.0 (one-time neighbourhood download)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      console.warn(`  failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass servers failed. Try again in a few minutes.');
}

const osm = await download();
const ways = osm.elements.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry);
const places = osm.elements.filter((e) => !(e.type === 'way' && e.tags?.highway && e.geometry));

const count = (fn) => places.filter((p) => fn(p.tags || {})).length;
console.log(`Got ${ways.length} street segments and ${places.length} places:`);
console.log(`  benches ${count((t) => t.amenity === 'bench')}, worship ${count((t) => t.amenity === 'place_of_worship')}, ` +
  `parks ${count((t) => t.leisure === 'park' || t.leisure === 'garden')}, water/dam ${count((t) => t.waterway || t.natural === 'water')}, ` +
  `stadium/pitch ${count((t) => t.leisure === 'stadium' || t.leisure === 'pitch')}, shops ${count((t) => t.shop)}, ` +
  `tea/food ${count((t) => ['cafe', 'fast_food', 'restaurant'].includes(t.amenity))}, market ${count((t) => t.amenity === 'marketplace')}, ` +
  `trees ${count((t) => t.natural === 'tree')}`);

await mkdir(DATA_DIR, { recursive: true });
await writeFile(out, JSON.stringify({
  fetchedAt: new Date().toISOString(),
  source: 'OpenStreetMap contributors, ODbL',
  ways: ways.map((w) => ({ id: w.id, tags: w.tags, nodes: w.nodes, geometry: w.geometry })),
  places: places.map((p) => ({
    id: `${p.type}/${p.id}`,
    tags: p.tags || {},
    lat: p.lat ?? p.center?.lat,
    lon: p.lon ?? p.center?.lon,
  })).filter((p) => Number.isFinite(p.lat)),
}));
console.log(`Saved ${out}`);
