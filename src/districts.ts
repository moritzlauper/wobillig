import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import type { City } from './cities';

export type District = Feature<Polygon | MultiPolygon, { number: number }>;
export type Districts = FeatureCollection<Polygon | MultiPolygon, { number: number }>;

export function districtFromSearch(params: URLSearchParams, city: City) {
  if (city !== 'zurich') return { enabled: false, selected: undefined };
  const number = Number(params.get('kreis'));
  const selected = Number.isInteger(number) && number >= 1 && number <= 12 ? number : undefined;
  return { enabled: params.get('kreise') === '1' || selected !== undefined, selected };
}

// Ray casting in GeoJSON longitude/latitude order, including boundary points.
function inRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function containsLocation(district: District, location: { lat: number; lon: number }): boolean {
  const point = [location.lon, location.lat];
  const bbox = district.bbox;
  if (bbox && (point[0] < bbox[0] || point[1] < bbox[1] || point[0] > bbox[2] || point[1] > bbox[3])) return false;
  const polygons = district.geometry.type === 'Polygon' ? [district.geometry.coordinates] : district.geometry.coordinates;
  return polygons.some(rings => inRing(point, rings[0]) && !rings.slice(1).some(hole => inRing(point, hole)));
}

export function createDistrictLookup(districts: Districts) {
  const cache = new Map<string, number | undefined>();
  return (location: { lat: number; lon: number }) => {
    const key = `${location.lat},${location.lon}`;
    if (!cache.has(key)) cache.set(key, districts.features.find(d => containsLocation(d, location))?.properties.number);
    return cache.get(key);
  };
}
