// Apartment search for Zürich, using the listings collected by angebunden
// (github.com/moritzlauper/angebunden, pipeline/20-wohnungen.ts). The format and
// the filter rules mirror angebunden's app/wohnungen/typen.ts and filter.ts, so an
// alert email brings exactly what the map shows with the same filters.
// Shared by the browser (src/apartments.ts) and the server (server/apartments.ts):
// no DOM, no Node APIs.

export type ApartmentSource = 'flatfox' | 'ronorp' | 'woko' | 'pwg' | 'abz' | 'gen';
export type ApartmentKind = 'wohnung' | 'wg' | 'studio' | 'haus' | 'moebliert';
export type ApartmentFeature = 'balkon' | 'waschmaschine' | 'geschirrspueler' | 'lift' | 'haustiere' | 'hindernisfrei';

export type Apartment = {
  id: string;
  links: { quelle: ApartmentSource; url: string }[];
  titel: string;
  art: ApartmentKind;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  lon: number | null;
  lat: number | null;
  zimmer: number | null;
  flaeche: number | null;
  /** Gross monthly rent in CHF. */
  miete: number | null;
  bezug: string | null;
  bild: string | null;
  /** First seen by the collector (ISO). */
  erstGesehen: string;
  befristet?: boolean;
  befristetBis?: string | null;
  merkmale?: ApartmentFeature[];
  tausch?: boolean;
  vorsicht?: boolean;
};

export type ApartmentSourceStatus = { id: ApartmentSource; name: string; anzahl: number; ok: boolean; zuletzt: string | null };
export type ApartmentData = { erstellt: string; quellen: ApartmentSourceStatus[]; inserate: Apartment[] };

export const apartmentSourceNames: Record<ApartmentSource, string> = {
  flatfox: 'Flatfox', ronorp: 'Ron Orp', woko: 'WOKO', pwg: 'Stiftung PWG', abz: 'ABZ', gen: 'Genossenschaften',
};
export const apartmentSources = Object.keys(apartmentSourceNames) as ApartmentSource[];
export const apartmentKindLabels: Record<ApartmentKind, string> = {
  wohnung: 'Wohnung', wg: 'WG-Zimmer', studio: 'Studio', moebliert: 'Möbliert', haus: 'Haus',
};
export const apartmentKinds = Object.keys(apartmentKindLabels) as ApartmentKind[];
export const apartmentFeatureLabels: Record<ApartmentFeature, string> = {
  balkon: 'Balkon', waschmaschine: 'Eigene Waschmaschine', geschirrspueler: 'Geschirrspüler',
  lift: 'Lift', haustiere: 'Haustiere erlaubt', hindernisfrei: 'Hindernisfrei',
};
export const apartmentFeatures = Object.keys(apartmentFeatureLabels) as ApartmentFeature[];
export const apartmentSortLabels = {
  neu: 'Neueste zuerst', guenstig: 'Günstigste zuerst', m2: 'Preis pro m²', gross: 'Grösste zuerst',
} as const;
export type ApartmentSort = keyof typeof apartmentSortLabels;
export const apartmentDurationLabels = { alle: 'Alle', unbefristet: 'Unbefristet', lang: 'Ab 1 Jahr', befristet: 'Befristet' } as const;
export type ApartmentDuration = keyof typeof apartmentDurationLabels;

/** A drawn area: longitude/latitude corners. */
export type ApartmentArea = { punkte: [number, number][] };

export type ApartmentFilter = {
  mieteMax: number | null;
  zimmerMin: number | null;
  zimmerMax: number | null;
  flaecheMin: number | null;
  arten: ApartmentKind[];
  /** Deselected sources, so new sources show up on their own. */
  quellenAus: ApartmentSource[];
  text: string;
  /**
   * Wishes from the smart search such as «hell» or «Altbau», with their usual wordings:
   * a listing matches if its title contains any of them.
   */
  begriffe: string[];
  dauer: ApartmentDuration;
  merkmale: ApartmentFeature[];
  /** Hide swaps and listings with signs of fraud. */
  ohneZweifel: boolean;
  /** Zürich Kreise (public/data/districts.json). */
  kreise: number[];
  gebiete: ApartmentArea[];
  sorte: ApartmentSort;
  /**
   * «Günstig», on by default like on the price maps: hides the more expensive listings
   * of the selection (see cheapApartments). Has no effect once a rent limit is set.
   */
  guenstig: boolean;
  /** Page-only filters; an alert ignores them. */
  nurNeu: boolean;
  nurGemerkt: boolean;
};

export const emptyApartmentFilter = (): ApartmentFilter => ({
  mieteMax: null, zimmerMin: null, zimmerMax: null, flaecheMin: null,
  arten: [...apartmentKinds], quellenAus: [], text: '', begriffe: [], dauer: 'alle',
  merkmale: [], ohneZweifel: false, kreise: [], gebiete: [], sorte: 'neu', guenstig: true, nurNeu: false, nurGemerkt: false,
});

export const DAY_MS = 24 * 3600 * 1000;

/** Point in polygon (ray casting), longitude/latitude. */
export function inArea(lon: number, lat: number, area: ApartmentArea): boolean {
  let inside = false;
  const p = area.punkte;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type ApartmentContext = {
  now: number;
  saved?: ReadonlySet<string>;
  /** Kreis number of a position, from the official boundaries. */
  district?: (location: { lat: number; lon: number }) => number | undefined;
};

export function matchesApartment(i: Apartment, f: ApartmentFilter, context: ApartmentContext): boolean {
  if (f.nurGemerkt && !context.saved?.has(i.id)) return false;
  if (!f.arten.includes(i.art)) return false;
  if (i.links.every(link => f.quellenAus.includes(link.quelle))) return false;
  if (f.mieteMax != null && (i.miete == null || i.miete > f.mieteMax)) return false;
  if (f.zimmerMin != null && (i.zimmer == null || i.zimmer < f.zimmerMin)) return false;
  if (f.zimmerMax != null && (i.zimmer == null || i.zimmer > f.zimmerMax)) return false;
  if (f.flaecheMin != null && (i.flaeche == null || i.flaeche < f.flaecheMin)) return false;
  if (f.nurNeu && context.now - Date.parse(i.erstGesehen) > DAY_MS) return false;
  if (f.dauer === 'befristet' && !i.befristet) return false;
  if (f.dauer === 'unbefristet' && i.befristet) return false;
  // Without a known end, a fixed term counts as short.
  if (f.dauer === 'lang' && i.befristet && !(i.befristetBis && Date.parse(i.befristetBis) - context.now >= 365 * DAY_MS)) return false;
  if (f.merkmale.length && !f.merkmale.every(m => i.merkmale?.includes(m))) return false;
  if (f.ohneZweifel && (i.tausch || i.vorsicht)) return false;
  if (f.kreise.length || f.gebiete.length) {
    if (i.lon == null || i.lat == null) return false;
    const lon = i.lon, lat = i.lat;
    const inKreis = f.kreise.length > 0 && context.district !== undefined && f.kreise.includes(context.district({ lat, lon }) ?? -1);
    const inDrawn = f.gebiete.some(area => inArea(lon, lat, area));
    if (!inKreis && !inDrawn) return false;
  }
  if (f.text.trim() || f.begriffe.length) {
    const haystack = `${i.titel} ${i.strasse ?? ''} ${i.plz ?? ''} ${i.ort ?? ''}`.toLowerCase();
    if (!f.text.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word))) return false;
    if (f.begriffe.length && !f.begriffe.some(word => haystack.includes(word))) return false;
  }
  return true;
}

export function sortApartments(list: Apartment[], sort: ApartmentSort): Apartment[] {
  const missingLast = (value: number | null | undefined, direction: 1 | -1) => value == null ? Infinity : value * direction;
  const key: Record<ApartmentSort, (i: Apartment) => number> = {
    neu: i => -Date.parse(i.erstGesehen),
    guenstig: i => missingLast(i.miete, 1),
    m2: i => i.miete != null && i.flaeche ? i.miete / i.flaeche : Infinity,
    gross: i => missingLast(i.flaeche, -1),
  };
  return [...list].sort((a, b) => key[sort](a) - key[sort](b));
}

const numberOrNull = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const pick = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is T => allowed.includes(item as T)))] : [];

/** Checks a filter from the browser or storage; anything unexpected falls back to the default. */
export function parseApartmentFilter(value: unknown): ApartmentFilter {
  const base = emptyApartmentFilter();
  if (!value || typeof value !== 'object') return base;
  const v = value as Record<string, unknown>;
  const areas = Array.isArray(v.gebiete) ? v.gebiete.slice(0, 10).flatMap(area => {
    const points = (area as { punkte?: unknown })?.punkte;
    if (!Array.isArray(points) || points.length < 3 || points.length > 200) return [];
    const valid = points.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2
      && typeof p[0] === 'number' && typeof p[1] === 'number' && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
      .map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number]);
    return valid.length === points.length ? [{ punkte: valid }] : [];
  }) : [];
  const arten = pick(v.arten, apartmentKinds);
  return {
    mieteMax: numberOrNull(v.mieteMax, 0, 100000),
    zimmerMin: numberOrNull(v.zimmerMin, 0, 20),
    zimmerMax: numberOrNull(v.zimmerMax, 0, 20),
    flaecheMin: numberOrNull(v.flaecheMin, 0, 2000),
    arten: Array.isArray(v.arten) ? arten : base.arten,
    quellenAus: pick(v.quellenAus, apartmentSources),
    text: typeof v.text === 'string' ? v.text.slice(0, 120) : '',
    begriffe: Array.isArray(v.begriffe) ? [...new Set(v.begriffe.filter((word): word is string => typeof word === 'string')
      .map(word => word.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 16) : [],
    dauer: typeof v.dauer === 'string' && Object.hasOwn(apartmentDurationLabels, v.dauer) ? v.dauer as ApartmentDuration : 'alle',
    merkmale: pick(v.merkmale, apartmentFeatures),
    ohneZweifel: v.ohneZweifel === true,
    kreise: Array.isArray(v.kreise) ? [...new Set(v.kreise.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 12))] : [],
    gebiete: areas,
    sorte: typeof v.sorte === 'string' && Object.hasOwn(apartmentSortLabels, v.sorte) ? v.sorte as ApartmentSort : 'neu',
    guenstig: v.guenstig !== false,
    nurNeu: v.nurNeu === true,
    nurGemerkt: v.nurGemerkt === true,
  };
}

/** The filter an alert stores: page-only switches are dropped. */
export function alertFilter(f: ApartmentFilter): ApartmentFilter {
  return { ...parseApartmentFilter(f), nurNeu: false, nurGemerkt: false };
}

// «Günstig»: a WG room and a family flat do not compete on price, so the limit is set per
// type and room count. A group with enough listings keeps its cheaper half (ties included);
// a smaller group borrows the limit of its type as a whole, and stays whole if that is small
// too. With few listings overall, or if the cheap selection would leave too little, nothing
// is filtered.
export const CHEAP_SHARE = 0.5, CHEAP_MIN_GROUP = 8, CHEAP_MIN_TOTAL = 40, CHEAP_MIN_KEEP = 20;
const roomGroup = (i: Apartment) => `${i.art}:${i.zimmer == null ? '?' : Math.min(5, Math.floor(i.zimmer))}`;

/** Whether «Günstig» applies to this filter: it is on and no rent limit of its own is set. */
export const cheapActive = (f: ApartmentFilter) => f.guenstig && f.mieteMax == null && !f.nurGemerkt;

/** Keeps the cheaper listings of a selection; `applied` is false when nothing was filtered. */
export function cheapApartments(list: Apartment[]): { list: Apartment[]; applied: boolean } {
  if (list.filter(i => i.miete != null).length < CHEAP_MIN_TOTAL) return { list, applied: false };
  const limitsBy = (key: (i: Apartment) => string) => {
    const prices = new Map<string, number[]>();
    for (const i of list) if (i.miete != null) prices.set(key(i), [...(prices.get(key(i)) || []), i.miete]);
    const limits = new Map<string, number>();
    for (const [group, values] of prices) {
      if (values.length < CHEAP_MIN_GROUP) continue;
      values.sort((a, b) => a - b);
      limits.set(group, values[Math.ceil(values.length * CHEAP_SHARE) - 1]);
    }
    return limits;
  };
  const byRooms = limitsBy(roomGroup), byKind = limitsBy(i => i.art);
  const cheap = list.filter(i => {
    const limit = byRooms.get(roomGroup(i)) ?? byKind.get(i.art);
    return limit === undefined || (i.miete != null && i.miete <= limit);
  });
  return cheap.length < CHEAP_MIN_KEEP || cheap.length === list.length ? { list, applied: false } : { list: cheap, applied: true };
}

/** The listings a filter shows: the per-listing rules, then «Günstig» over the whole selection. */
export function filterApartments(list: Apartment[], f: ApartmentFilter, context: ApartmentContext) {
  const matching = list.filter(i => matchesApartment(i, f, context));
  return cheapActive(f) ? cheapApartments(matching) : { list: matching, applied: false };
}

/** Swiss number format with apostrophes, as on wobillig. */
export const chf = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
export const roomsLabel = (rooms: number) => String(rooms).replace('.5', '½');

/** Rooms, area, address and caveats in one line, for the list, the detail and the email. */
export function apartmentFacts(i: Apartment, tr: (text: string, vars?: Record<string, string | number>) => string): string[] {
  return [
    i.zimmer != null ? tr('{rooms} Zi.', { rooms: roomsLabel(i.zimmer) }) : null,
    i.flaeche != null ? `${Math.round(i.flaeche)} m²` : null,
    [i.strasse, i.plz].filter(Boolean).join(', ') || null,
    i.befristet ? (i.befristetBis ? tr('befristet bis {date}', { date: i.befristetBis.split('-').reverse().join('.') }) : tr('befristet')) : null,
    i.tausch ? tr('Wohnungstausch') : null,
    i.vorsicht ? tr('Vorsicht: Zeichen für Betrug') : null,
  ].filter((item): item is string => Boolean(item));
}

/** A short name for a search, used for alerts: «bis CHF 1’700 · 2–4 Zi. · Kreis 4». */
export function describeApartmentFilter(f: ApartmentFilter, tr: (text: string, vars?: Record<string, string | number>) => string): string {
  const rooms = f.zimmerMin != null && f.zimmerMax != null ? (f.zimmerMin === f.zimmerMax ? roomsLabel(f.zimmerMin) : `${roomsLabel(f.zimmerMin)}–${roomsLabel(f.zimmerMax)}`)
    : f.zimmerMin != null ? tr('ab {rooms}', { rooms: roomsLabel(f.zimmerMin) }) : f.zimmerMax != null ? tr('bis {rooms}', { rooms: roomsLabel(f.zimmerMax) }) : null;
  const kinds = f.arten.length && f.arten.length < apartmentKinds.length ? f.arten.map(kind => tr(apartmentKindLabels[kind])).join(', ') : null;
  const parts = [
    cheapActive(f) ? tr('Günstig') : null,
    kinds,
    f.mieteMax != null ? tr('bis CHF {price}', { price: chf(f.mieteMax) }) : null,
    rooms ? tr('{rooms} Zi.', { rooms }) : null,
    f.flaecheMin != null ? tr('ab {area} m²', { area: f.flaecheMin }) : null,
    f.kreise.length ? f.kreise.length === 1 ? tr('Kreis {number}', { number: f.kreise[0] }) : tr('Kreise {numbers}', { numbers: [...f.kreise].sort((a, b) => a - b).join(', ') }) : null,
    f.gebiete.length ? f.gebiete.length === 1 ? tr('1 Gebiet') : tr('{count} Gebiete', { count: f.gebiete.length }) : null,
    f.dauer !== 'alle' ? tr(apartmentDurationLabels[f.dauer]) : null,
    ...f.merkmale.map(feature => tr(apartmentFeatureLabels[feature])),
    f.text.trim() ? `«${f.text.trim()}»` : null,
    f.begriffe.length ? `«${f.begriffe.slice(0, 3).join(', ')}»` : null,
  ].filter((part): part is string => Boolean(part));
  return (parts.join(' · ') || tr('Alle Wohnungen')).slice(0, 120);
}

/** Short, stable checksum of a link (FNV-1a, 32 bit), so an alert remembers what it has sent. */
export function linkChecksum(text: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
export const apartmentChecksums = (i: Apartment) => i.links.map(link => linkChecksum(link.url));

/** Keeps only what the map needs; drops the collector's memory (seen, AI results, pages). */
export function slimApartmentData(raw: unknown): ApartmentData {
  const value = raw as Partial<ApartmentData> | null;
  if (!value || !Array.isArray(value.inserate) || typeof value.erstellt !== 'string') throw new Error('Invalid apartment data');
  const inserate = value.inserate.filter(i => i && typeof i.id === 'string' && Array.isArray(i.links) && i.links.length > 0
    && typeof i.erstGesehen === 'string' && apartmentKinds.includes(i.art));
  return {
    erstellt: value.erstellt,
    quellen: Array.isArray(value.quellen) ? value.quellen.filter(q => q && apartmentSources.includes(q.id)) : [],
    // Transit and culture scores belong to angebunden's map; wobillig shows neither.
    inserate: inserate.map(({ oev: _oev, oevRang: _oevRang, kultur: _kultur, kulturRang: _kulturRang, ...rest }: Apartment & Record<string, unknown>) => rest as Apartment),
  };
}

/** Where else to search; these portals block automated requests, so they are links only. */
export function otherPortals(f: ApartmentFilter): { name: string; url: string }[] {
  const query = (parts: [string, number | null][]) => {
    const s = parts.filter(([, value]) => value != null).map(([key, value]) => `${key}=${value}`).join('&');
    return s ? `?${s}` : '';
  };
  return [
    { name: 'Homegate', url: 'https://www.homegate.ch/mieten/immobilien/ort-zuerich/trefferliste' + query([['ac', f.zimmerMin], ['ad', f.zimmerMax], ['ah', f.mieteMax], ['ak', f.flaecheMin]]) },
    { name: 'ImmoScout24', url: 'https://www.immoscout24.ch/de/immobilien/mieten/ort-zuerich' + query([['nrf', f.zimmerMin], ['nrt', f.zimmerMax], ['pt', f.mieteMax], ['slf', f.flaecheMin]]) },
    { name: 'Newhome', url: 'https://www.newhome.ch/de/mieten/suchen/wohnung/ort-zuerich/liste' },
    { name: 'wgzimmer.ch', url: 'https://www.wgzimmer.ch/de/wgzimmer/search/mate/ch/zurich-stadt.html' },
    { name: 'Stadt Zürich', url: 'https://www.stadt-zuerich.ch/de/lebenslagen/wohnen/freie-wohnungen.html' },
  ];
}
