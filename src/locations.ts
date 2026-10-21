import { distance, type Bar } from './data.js';

// A sparse category export must not erase an address recorded for the same POI.
export function withKnownAddress(bar: Bar, known?: Bar): Bar {
  if (!known || known.id !== bar.id) return bar;
  const address = bar.address.trim() || known.address;
  const postcode = bar.postcode.trim() || (!bar.address.trim() || bar.address === known.address ? known.postcode : '');
  return address === bar.address && postcode === bar.postcode ? bar : { ...bar, address, postcode };
}

export function googleMapsLink(bar: Pick<Bar, 'name' | 'address' | 'postcode' | 'lat' | 'lon'>, city: string): string {
  const query = bar.address.trim()
    ? [bar.name, bar.address, bar.postcode, city, 'Schweiz'].filter(Boolean).join(', ')
    : `${bar.lat},${bar.lon}`;
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`;
}

// Coordinates are POIs, not building outlines: only resolve a close, precise,
// unambiguous fix. Compare every known venue, including filtered-out neighbours.
export function locationAtPosition(venues: Bar[], position: [number, number], accuracy: number): Bar | undefined {
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 20
    || !position.every(Number.isFinite) || Math.abs(position[0]) > 90 || Math.abs(position[1]) > 180) return;
  const nearest = selectableLocations(venues, [])
    .map(bar => ({ bar, metres: distance(position, [bar.lat, bar.lon]) * 1000 }))
    .filter(item => Number.isFinite(item.metres))
    .sort((a, b) => a.metres - b.metres);
  const [first, second] = nearest;
  if (!first || first.metres > 15 || first.metres + accuracy > 25) return;
  // The same venue must remain clearly nearest across the accuracy radius.
  if (second && second.metres - first.metres <= Math.max(20, accuracy * 2)) return;
  return first.bar;
}

type Point = { x: number; y: number };
// Raster map labels have no feature IDs. Resolve nearby OSM locations in screen
// space, then let the visitor choose if several venues are close together.
export function nearbyLocations(venues: Bar[], point: Point, project: (bar: Bar) => Point, radius = 80): Bar[] {
  return venues.map(bar => ({ bar, point: project(bar) }))
    .map(item => ({ bar: item.bar, distance: Math.hypot(item.point.x - point.x, item.point.y - point.y) }))
    .filter(item => item.distance <= radius)
    .sort((a, b) => a.distance - b.distance || a.bar.name.localeCompare(b.bar.name, 'de'))
    .slice(0, 6).map(item => item.bar);
}

export function selectableLocations(known: Bar[], catalogue: Bar[]): Bar[] {
  const merged = new Map<string, Bar>();
  for (const bar of [...catalogue, ...known]) merged.set(bar.id, withKnownAddress(bar, merged.get(bar.id)));
  return [...merged.values()];
}
