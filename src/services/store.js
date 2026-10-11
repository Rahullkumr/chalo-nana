// Reads and writes the family's private files in data/ (git-ignored).
// Falls back to examples/ so the app runs out of the box with a made-up village.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, EXAMPLES_DIR } from '../config.js';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readWithExample(name) {
  try {
    return { ...(await readJson(join(DATA_DIR, `${name}.json`))), example: false };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { ...(await readJson(join(EXAMPLES_DIR, `${name}.example.json`))), example: true };
  }
}

async function write(name, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, name), typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(value, null, 2));
}

export const loadPlaces = () => readWithExample('places');
export const loadWalker = () => readWithExample('walker');

export async function loadWalks() {
  try {
    return await readJson(join(DATA_DIR, 'walks.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function addWalk(walk) {
  const walks = await loadWalks();
  walks.push(walk);
  await write('walks.json', walks);
  return walks;
}

export async function loadToday() {
  try {
    return await readJson(join(DATA_DIR, 'today.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export const saveToday = (plan) => write('today.json', plan);
export const saveTodayAudio = (buffer) => write('today.mp3', buffer);
export const todayAudioPath = join(DATA_DIR, 'today.mp3');
