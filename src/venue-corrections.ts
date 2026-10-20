import type { Bar } from './data.js';
import { InputError } from './community.js';

export type VenueChanges = Partial<Pick<Bar, 'name' | 'address' | 'postcode' | 'website'>>;
export type VenueCorrection = { barId: string; changes: VenueChanges; revision: number; updatedAt: string };

export function validateVenueCorrection(value: unknown): { barId: string; revision: number; changes: VenueChanges } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Ungültige Lokalkorrektur.');
  const x = value as Record<string, unknown>;
  if (typeof x.barId !== 'string' || !x.barId || !Number.isSafeInteger(x.revision) || (x.revision as number) < 0) {
    throw new InputError('Ungültige Lokalkorrektur.');
  }
  if (!x.changes || typeof x.changes !== 'object' || Array.isArray(x.changes)) throw new InputError('Ungültige Lokalkorrektur.');
  const changes: VenueChanges = {};
  for (const [key, value] of Object.entries(x.changes)) {
    if (!['name', 'address', 'postcode', 'website'].includes(key) || typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
      throw new InputError('Ungültige Lokalkorrektur.');
    }
    const text = value.trim();
    if (key === 'name' || key === 'address') {
      if (!text || text.length > (key === 'name' ? 100 : 160)) throw new InputError('Bitte Name und Strasse mit Hausnummer vollständig eingeben.');
      changes[key] = text;
    } else if (key === 'postcode') {
      if (!/^\d{4}$/.test(text)) throw new InputError('Bitte eine vierstellige Postleitzahl eingeben.');
      changes.postcode = text;
    } else {
      if (text.length > 1500) throw new InputError('Ungültige Website.');
      if (!text) { changes.website = null; continue; }
      try {
        const url = new URL(text);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        changes.website = url.href;
      } catch { throw new InputError('Die Website muss mit https:// oder http:// beginnen.'); }
    }
  }
  if (!Object.keys(changes).length) throw new InputError('Bitte mindestens eine Angabe ändern.');
  return { barId: x.barId, revision: x.revision as number, changes };
}

export function applyVenueCorrections(bars: Bar[], corrections: VenueCorrection[]): Bar[] {
  const byId = new Map(corrections.map(correction => [correction.barId, correction.changes]));
  return bars.map(bar => ({ ...bar, ...byId.get(bar.id) }));
}
