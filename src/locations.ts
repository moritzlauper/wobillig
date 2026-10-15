import type { Bar } from './data.js';

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
