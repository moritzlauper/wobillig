import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isOpenAt, openTime, parseOpeningHours, zurichTime } from '../src/opening-hours';

const at = (weekday: number, time: string, month = 9) => {
  const [hours, minutes] = time.split(':').map(Number);
  return { weekday, month, minutes: hours * 60 + minutes };
};
const MO = 0, FR = 4, SA = 5, SU = 6;

it('reads weekday ranges, several spans per day and closed days', () => {
  const hours = 'Mo-Fr 11:30-14:00,17:30-22:00; Sa 17:30-22:00; Su off';
  expect(isOpenAt(hours, at(MO, '12:00'))).toBe(true);
  expect(isOpenAt(hours, at(MO, '15:00'))).toBe(false);
  expect(isOpenAt(hours, at(SA, '12:00'))).toBe(false);
  expect(isOpenAt(hours, at(SA, '21:59'))).toBe(true);
  expect(isOpenAt(hours, at(SA, '22:00'))).toBe(false);
  expect(isOpenAt(hours, at(SU, '19:00'))).toBe(false);
});

it('carries spans past midnight into the next morning', () => {
  const hours = 'Mo-Th 10:30-04:00, Fr,Sa 10:30-05:00';
  expect(isOpenAt(hours, at(SA, '04:30'))).toBe(true);
  expect(isOpenAt(hours, at(SU, '04:30'))).toBe(true);
  expect(isOpenAt(hours, at(SU, '05:30'))).toBe(false);
  expect(isOpenAt(hours, at(SU, '12:00'))).toBe(false);
  expect(isOpenAt('Tu-Th 17:00-24:00; Fr-Sa 17:00-26:00', at(SU, '01:30'))).toBe(true);
  expect(isOpenAt('Mo-Fr 11:45-14:00, 19:00-00:00', at(FR, '23:59'))).toBe(true);
});

it('lets later rules replace earlier ones for their days and respects months', () => {
  const hours = 'Mo-Fr 12:00-14:30,19:00-22:00; Sa,Su,PH 12:30-15:00,18:30-21:30; Sa 18:30-22:30';
  expect(isOpenAt(hours, at(SA, '13:00'))).toBe(false);
  expect(isOpenAt(hours, at(SA, '22:00'))).toBe(true);
  expect(isOpenAt(hours, at(SU, '13:00'))).toBe(true);
  const seasonal = 'Nov-Mar Mo-Sa 11:30-22:00; Apr-Oct Su-Th 11:00-23:00; Apr-Oct Fr-Sa 11:00-24:00';
  expect(isOpenAt(seasonal, at(SU, '12:00', 0))).toBe(false);
  expect(isOpenAt(seasonal, at(SU, '12:00', 6))).toBe(true);
  expect(isOpenAt(seasonal, at(SA, '23:30', 6))).toBe(true);
});

it('returns undefined instead of guessing', () => {
  expect(isOpenAt(null, at(MO, '12:00'))).toBeUndefined();
  expect(isOpenAt('Mo-Su open "time not specified"', at(MO, '12:00'))).toBeUndefined();
  expect(isOpenAt('Mo-Fr sunrise-sunset', at(MO, '12:00'))).toBeUndefined();
  expect(isOpenAt('closed "Renovation"', at(MO, '12:00'))).toBe(false);
  expect(isOpenAt('24/7', at(SU, '03:00'))).toBe(true);
  expect(isOpenAt('Mo-Fr 07:45-24:00,Sa 10:00-24:00;PH off', at(SA, '11:00'))).toBe(true);
});

it('understands nearly all hours recorded for priced venues', () => {
  const root = new URL('../public/data/', import.meta.url);
  const values = new Set<string>();
  for (const dir of ['', ...readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `${entry.name}/`)]) {
    for (const file of ['bars.json', 'coffee.json', 'pizza.json']) {
      const path = new URL(`${dir}${file}`, root);
      if (!existsSync(path)) continue;
      for (const bar of JSON.parse(readFileSync(path, 'utf8')).bars) if (bar.offers.length && bar.openingHours) values.add(bar.openingHours);
    }
  }
  const understood = [...values].filter(value => parseOpeningHours(value));
  expect(understood.length / values.size).toBeGreaterThan(0.95);
});

it('converts to Zürich time and moves early hours to the next day', () => {
  // 2026-11-02 is a Monday; 21:30 UTC is 22:30 in Zürich.
  expect(zurichTime(new Date('2026-11-02T21:30:00Z'))).toEqual({ weekday: MO, month: 10, minutes: 22 * 60 + 30 });
  const now = at(MO, '22:30', 10);
  expect(openTime('now', now)).toEqual(now);
  expect(openTime('23:00', now)).toEqual(at(MO, '23:00', 10));
  expect(openTime('02:00', now)).toEqual(at(1, '02:00', 10));
});
