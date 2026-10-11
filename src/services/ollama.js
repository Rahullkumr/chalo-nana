// Talks to the local Ollama model. Everything here stays on this computer.
import { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_KEEP_ALIVE } from '../config.js';

// Loads the model into memory so the first real request does not pay the load time.
export async function warmUp() {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: OLLAMA_KEEP_ALIVE }),
  });
  if (!res.ok) throw new Error(`Ollama warm-up failed (${res.status}): ${await res.text()}`);
}

// Some models reject the think option; remember that after the first try.
let thinkSupported = true;

// Sends a system + user prompt and returns the JSON object that matches `schema`.
export async function chatJSON({ system, user, schema, options = {}, signal }) {
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    format: schema,
    options: { temperature: 0.4, top_p: 0.9, num_predict: 1200, ...options },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  const send = (withThink) => fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(withThink ? { ...body, think: false } : body),
  });

  let res = await send(thinkSupported);
  if (!res.ok && thinkSupported) {
    const text = await res.text();
    if (!/think/i.test(text)) throw new Error(`Ollama error ${res.status}: ${text}`);
    thinkSupported = false;
    res = await send(false);
  }
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const msg = await res.json();
  return {
    result: JSON.parse(msg.message.content),
    stats: { seconds: Math.round(msg.total_duration / 1e8) / 10, tokens: msg.eval_count },
  };
}
