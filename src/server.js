// Local web server for Chalo Nana: the family page, Nana's one-button page,
// walk planning on this computer, and the ElevenLabs voice for the spoken plan.
import { networkInterfaces } from 'node:os';
import Fastify from 'fastify';
import { HOST, PORT, OLLAMA_MODEL } from './config.js';
import { warmUp } from './services/ollama.js';
import { ttsEnabled } from './services/elevenlabs.js';
import apiRoutes from './routes/api.js';
import speakRoutes from './routes/speak.js';
import pageRoutes from './routes/pages.js';

const app = Fastify({ logger: true });

await app.register(apiRoutes);
await app.register(speakRoutes);
await app.register(pageRoutes);

await app.listen({ host: HOST, port: PORT });
app.log.info(ttsEnabled ? 'ElevenLabs voice enabled' : 'ELEVENLABS_API_KEY not set, pages will use a local voice');
if (HOST === '0.0.0.0') {
  const lan = Object.values(networkInterfaces()).flat()
    .filter((i) => i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}/nana.html`);
  app.log.info(`Nana's page on the phone (same Wi-Fi): ${lan.join('  ')}`);
}
warmUp()
  .then(() => app.log.info(`Model ${OLLAMA_MODEL} loaded`))
  .catch((err) => app.log.warn(`Model warm-up failed, is Ollama running? ${err.message}`));
