import { distance, type Bar } from '../src/data.js';

type Place = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  addressComponents?: { longText: string; types: string[] }[];
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  attributions?: { provider?: string; providerUri?: string }[];
};
export type GoogleRating = {
  rating: number;
  reviewCount: number;
  mapsUrl: string;
  attributions: { provider: string; url: string }[];
};
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
const words = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) || [];
const genericNames = new Set(['restaurant', 'ristorante', 'pizzeria', 'pizza', 'bar', 'cafe', 'zurich', 'zurichs', 'zuerich', 'bern', 'basel', 'winterthur', 'olten']);

export function sameName(a: string, b: string): boolean {
  const first = words(a).filter(word => !genericNames.has(word));
  const secondWords = words(b).filter(word => !genericNames.has(word));
  const second = new Set(secondWords);
  // Brand spacing can differ ("Quartier 5" / "Quartier5"). Keep every
  // significant letter and digit; address and distance are checked separately.
  return first.length > 0 && (first.join('') === secondWords.join('')
    || first.filter(word => second.has(word)).length / first.length >= .8);
}

function matchesVenue(bar: Bar, place: Place): boolean {
  const location = place.location;
  if (!place.id || !place.displayName?.text || !location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
    || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180 || place.businessStatus === 'CLOSED_PERMANENTLY'
    || !sameName(bar.name, place.displayName.text)) return false;
  const metres = distance([bar.lat, bar.lon], [location.latitude, location.longitude]) * 1000;
  if (metres > 150) return false;
  if (!bar.address.trim()) return metres <= 50;
  const street = place.addressComponents?.find(component => component.types.includes('route'))?.longText;
  const number = place.addressComponents?.find(component => component.types.includes('street_number'))?.longText;
  // An exact street and house number avoids matching a neighbouring branch.
  return Boolean(street && number && normalize(bar.address) === normalize(`${street} ${number}`));
}

export function matchGoogleRating(bar: Bar, places: Place[]): GoogleRating | null {
  const matches = [...new Map(places.filter(place => matchesVenue(bar, place)).map(place => [place.id, place])).values()];
  if (matches.length !== 1) return null;
  const place = matches[0];
  if (typeof place.rating !== 'number' || !Number.isFinite(place.rating) || place.rating < 1 || place.rating > 5
    || !Number.isInteger(place.userRatingCount) || place.userRatingCount! < 1 || !place.googleMapsUri) return null;
  const url = new URL(place.googleMapsUri);
  if (url.protocol !== 'https:' || !['maps.google.com', 'www.google.com'].includes(url.hostname)) return null;
  return { rating: place.rating, reviewCount: place.userRatingCount!, mapsUrl: url.href,
    attributions: (place.attributions || []).flatMap(attribution => {
      if (!attribution.provider || !attribution.providerUri || !/^https?:\/\//.test(attribution.providerUri)) return [];
      return [{ provider: attribution.provider, url: attribution.providerUri }];
    }) };
}

export async function fetchGoogleRating(bar: Bar, city: string, key: string): Promise<GoogleRating | null> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.addressComponents,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.businessStatus,places.attributions' },
    body: JSON.stringify({ textQuery: [bar.name, bar.address, bar.postcode, city, 'Schweiz'].filter(Boolean).join(', '),
      languageCode: 'de', regionCode: 'CH', pageSize: 5,
      locationBias: { circle: { center: { latitude: bar.lat, longitude: bar.lon }, radius: 200 } } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Places request failed (${response.status})`);
  const data = await response.json() as { places?: Place[] };
  return matchGoogleRating(bar, data.places || []);
}
