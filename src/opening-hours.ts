// A subset of the OpenStreetMap opening_hours syntax, enough for the venues on the map:
// month and weekday ranges, several time spans per day, spans past midnight, "off" and 24/7.
// Anything else (dates, public holidays as the only selector, sunrise, week numbers) makes the
// whole value unknown, so a venue is never shown as open on a guess.

export type LocalTime = { weekday: number; month: number; minutes: number };
type Rule = { months?: Set<number>; days?: Set<number>; spans: [number, number][] | 'off' | 'unknown'; additional: boolean };

const weekdays = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function range(list: string[], value: string): Set<number> | undefined {
  const result = new Set<number>();
  for (const part of value.split(',')) {
    const [from, to] = part.split('-').map(item => list.indexOf(item));
    if (from < 0 || (to !== undefined && to < 0)) return undefined;
    // Ranges such as Fr-Mo or Nov-Mar wrap around.
    for (let i = from; ; i = (i + 1) % list.length) { result.add(i); if (to === undefined || i === to) break; }
  }
  return result;
}

function minutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[1]) > 48) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseRule(text: string, additional: boolean): Rule | null | undefined {
  let rest = text.replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!rest) return null;
  if (rest === '24/7') return { spans: [[0, 1440]], additional };
  const rule: Rule = { spans: 'unknown', additional };
  const monthMatch = /^((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:-(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))?(?:,(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:-(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))?)*)\s*:?\s*/.exec(rest);
  if (monthMatch) { rule.months = range(months, monthMatch[1]); rest = rest.slice(monthMatch[0].length); }
  const dayMatch = /^((?:mo|tu|we|th|fr|sa|su|ph|sh)(?:-(?:mo|tu|we|th|fr|sa|su))?(?:\s*,\s*(?:mo|tu|we|th|fr|sa|su|ph|sh)(?:-(?:mo|tu|we|th|fr|sa|su))?)*)\b\s*:?\s*/.exec(rest);
  if (dayMatch) {
    const selectors = dayMatch[1].replace(/\s/g, '').split(',').filter(item => item !== 'ph' && item !== 'sh');
    // A rule only for public or school holidays does not say anything about an ordinary day.
    if (!selectors.length) return null;
    rule.days = range(weekdays, selectors.join(','));
    rest = rest.slice(dayMatch[0].length);
  }
  if ((monthMatch && !rule.months) || (dayMatch && !rule.days)) return undefined;
  if (rest === 'off' || rest === 'closed') rule.spans = 'off';
  else if (rest === 'open' || rest === '') rule.spans = rest === '' && !dayMatch && !monthMatch ? 'off' : 'unknown';
  else {
    const spans: [number, number][] = [];
    for (const part of rest.split(/\s*,\s*/)) {
      const match = /^(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2})|(\+))$/.exec(part);
      if (!match) return undefined;
      const start = minutes(match[1]);
      // Open end: count the evening until midnight, never longer.
      let end = match[3] ? 1440 : minutes(match[2]);
      if (start === undefined || end === undefined) return undefined;
      if (end <= start) end += 1440;
      spans.push([start, Math.max(end, start)]);
    }
    rule.spans = spans;
  }
  return rule;
}

const cache = new Map<string, Rule[] | undefined>();
export function parseOpeningHours(value: string): Rule[] | undefined {
  if (cache.has(value)) return cache.get(value);
  const rules: Rule[] = [];
  let valid = true;
  for (const group of value.split(/\s*(?:;|\|\|)\s*/)) {
    // A comma before a new weekday or month selector starts an additional rule: "Mo-Th 10:00-02:00, Fr,Sa 10:00-04:00".
    const parts = group.split(/(?<=\d|\+|off|closed|")\s*,\s*(?=[A-Za-z])/);
    parts.forEach((part, index) => {
      const rule = parseRule(part, index > 0);
      if (rule === undefined) valid = false;
      else if (rule) rules.push(rule);
    });
  }
  const result = valid && rules.length ? rules : undefined;
  cache.set(value, result);
  return result;
}

function spansFor(rules: Rule[], weekday: number, month: number): [number, number][] | 'unknown' {
  let spans: [number, number][] | 'unknown' = [];
  for (const rule of rules) {
    if (rule.months && !rule.months.has(month)) continue;
    if (rule.days && !rule.days.has(weekday)) continue;
    // A later rule replaces earlier ones for its days; an additional rule adds to them.
    const own = rule.spans === 'off' ? [] : rule.spans;
    if (own === 'unknown') spans = 'unknown';
    else if (rule.additional && spans !== 'unknown') spans = [...spans, ...own];
    else spans = own;
  }
  return spans;
}

// true or false from the venue's hours, undefined when they are missing or not understood.
export function isOpenAt(value: string | null | undefined, at: LocalTime): boolean | undefined {
  if (!value) return undefined;
  const rules = parseOpeningHours(value);
  if (!rules) return undefined;
  const today = spansFor(rules, at.weekday, at.month);
  const yesterdayWeekday = (at.weekday + 6) % 7;
  // A span past midnight belongs to the day it started; the month is close enough to stay the same.
  const yesterday = spansFor(rules, yesterdayWeekday, at.month);
  if (today !== 'unknown' && today.some(([start, end]) => start <= at.minutes && at.minutes < end)) return true;
  if (yesterday !== 'unknown' && yesterday.some(([, end]) => at.minutes + 1440 < end)) return true;
  return today === 'unknown' || yesterday === 'unknown' ? undefined : false;
}

export function zurichTime(date = new Date()): LocalTime {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(part => [part.type, part.value]));
  return { weekday: weekdays.indexOf(String(parts.weekday).slice(0, 2).toLowerCase()), month: Number(parts.month) - 1, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// "now" or a time of day as HH:MM. A time well before now means tonight after midnight, so the next day.
export function openTime(open: string, now = zurichTime()): LocalTime {
  const match = /^(\d{2}):(\d{2})$/.exec(open);
  if (!match) return now;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < now.minutes - 60 ? { ...now, weekday: (now.weekday + 1) % 7, minutes } : { ...now, minutes };
}
