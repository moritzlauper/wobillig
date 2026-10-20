import type { State } from './prices.js';
import type { PriceChange } from './price-audit.js';
import type { City } from '../src/cities.js';
import type { Bar } from '../src/data.js';
import type { CustomMap } from '../src/custom-map-data.js';

export type ReviewRow = PriceChange & { exact: boolean; city: City };
export function reviewRows(state: State, city: City, venues?: Bar[]): ReviewRow[];
export function reviewCsv(rows: ReviewRow[]): string;
export function reviewHtml(rows: ReviewRow[], environment: string, generatedAt?: string, online?: boolean, maps?: { city: City; map: CustomMap }[], mapReviewsHtml?: string): string;
