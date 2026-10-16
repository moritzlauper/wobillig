import { distance, type Bar } from './data.js';

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
  return [...new Map([...catalogue, ...known].map(bar => [bar.id, bar])).values()];
}
