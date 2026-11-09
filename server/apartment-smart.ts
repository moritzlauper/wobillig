// Reads a smart search sentence for the apartment map with Claude and returns the filters
// (src/apartment-smart.ts has the schema, the instructions and the rules the browser uses first).
import { InputError } from '../src/community.js';
import { APARTMENT_SMART_MAX, APARTMENT_SMART_SCHEMA, APARTMENT_SMART_SYSTEM, queryFromClaude, type ApartmentQuery } from '../src/apartment-smart.js';

// The same model as the menu scan: a sentence is short, the answer a small JSON object.
export const APARTMENT_SMART_MODEL = 'claude-haiku-5-5';

export async function readApartmentQuery(text: unknown, apiKey: string, fetcher: typeof fetch = fetch): Promise<ApartmentQuery> {
  if (typeof text !== 'string' || !text.trim()) throw new InputError('Bitte einen Suchsatz eingeben.');
  const sentence = text.trim().slice(0, APARTMENT_SMART_MAX);
  let response: Response;
  try {
    response = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: APARTMENT_SMART_MODEL, max_tokens: 800, thinking: { type: 'disabled' },
        system: APARTMENT_SMART_SYSTEM,
        messages: [{ role: 'user', content: `Search sentence: ${JSON.stringify(sentence)}` }],
        output_config: { format: { type: 'json_schema', schema: APARTMENT_SMART_SCHEMA } },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new InputError('Die Smart-Suche ist gerade nicht erreichbar.', 503); }
  if (!response.ok) throw new InputError('Die Smart-Suche ist gerade nicht verfügbar.', 503);
  const reply = await response.json() as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (reply.stop_reason !== 'end_turn') throw new InputError('Die Smart-Suche konnte den Satz nicht lesen.', 503);
  let parsed: unknown;
  try { parsed = JSON.parse((reply.content || []).filter(block => block.type === 'text').map(block => block.text || '').join('')); }
  catch { throw new InputError('Die Smart-Suche konnte den Satz nicht lesen.', 503); }
  const query = queryFromClaude(parsed);
  if (!query) throw new InputError('Die Smart-Suche konnte den Satz nicht lesen.', 503);
  return query;
}
