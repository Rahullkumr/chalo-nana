// Every setting the app reads from the environment, with defaults. See .env.example.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT) || 3000;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || 'data');
export const EXAMPLES_DIR = resolve(ROOT, 'examples');

// 127.0.0.1, not localhost: Node 22 tries IPv6 ::1 first, and Ollama listens on IPv4 only.
export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b';
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
// Default: George, a premade multilingual voice. After the first walk Nana asked for an Indian
// accent, so his .env points at an Indian-accent female Hindi voice from the ElevenLabs library.
// Match walker.speaker ("granddaughter" / "grandson") to the voice, so the Hindi verbs agree.
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
// Supports Hindi and the speed setting.
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
