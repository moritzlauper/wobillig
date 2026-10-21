import { InputError } from '../src/community.js';
import type { State } from './prices.js';
export const protectionEnabled = () => process.env.CONTRIBUTION_PROTECTION === 'true';
export const reviewRequired = () => process.env.COMMUNITY_REVIEW_REQUIRED === 'true';
export function checkReviewCapacity(state: State) {
  if ((state.heldPrices?.length || 0) + (state.pendingVenues?.length || 0) + (state.pendingCorrections?.length || 0) >= 2000) throw new InputError('Es warten viele Beiträge auf Prüfung. Bitte später erneut versuchen.', 429);
}
