'use strict';

/**
 * Example: talk to the Sorin pool adapter like any OpenAI-compatible endpoint.
 *
 *   # terminal 1
 *   SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js
 *   # terminal 2
 *   node examples/inference.js
 */

const POOL = process.env.POOL_URL || 'http://127.0.0.1:8791/v1';

async function chat({ model = 'sorin-auto', messages, stream = false }) {
  const res = await fetch(`${POOL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  if (!stream) {
    const out = await res.json();
    return out.choices[0].message.content;
  }

  let text = '';
  for await (const line of res.body) {
    const s = line.toString();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const chunk = JSON.parse(payload);
      text += chunk.choices?.[0]?.delta?.content || '';
    } catch {
      /* partial frame */
    }
  }
  return text;
}

(async () => {
  const prompt = [{ role: 'user', content: 'Give me one sentence on tokenized assets.' }];

  console.log('models:', (await (await fetch(`${POOL}/models`)).json()).data.map((m) => m.id).join(', '));

  console.log('\n[auto]\n' + (await chat({ model: 'sorin-auto', messages: prompt })));
  console.log('\n[expert · streaming]\n' + (await chat({ model: 'sorin-expert', messages: prompt, stream: true })));
})().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
