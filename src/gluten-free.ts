// Only explicit labels count: a missing mention never makes a dish gluten-free.
const GLUTEN_FREE = /\b(?:glutenfrei\w*|gluten[- ]?free|sans gluten|senza glutine|ohne gluten)\b/i;
const GLUTEN_FREE_PIZZERIA = /\bglutenfreie?\s+pizzeria\b|\bgluten[- ]?free\s+pizzeria\b/i;

// The scraper sets glutenFree from the menu; other offers are checked by name and ingredients.
export function isGlutenFreeOffer(offer: { name: string; ingredients?: string; glutenFree?: boolean }): boolean {
  return offer.glutenFree === true || GLUTEN_FREE.test(`${offer.name} ${offer.ingredients || ''}`);
}

// A pizzeria that calls itself gluten-free on its own website serves only gluten-free pizza.
export function isGlutenFreePizzeria(venue: { pizzaEvidence?: { evidence: string } }): boolean {
  return GLUTEN_FREE_PIZZERIA.test(venue.pizzaEvidence?.evidence || '');
}
