export type PizzaSelection = 'all' | `name:${string}`;

export function pizzaName(name: string): string {
  return name.trim().replace(/^(?:\d{2,3}[a-z]?[.)]?|\d[.)]|\d(?=\s+pizza\b))\s+/i, '')
    .replace(/^pizza\s+/i, '').trim();
}

export function pizzaNameKey(name: string): string {
  return pizzaName(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
}

export function parsePizzaSelection(value: string | null): PizzaSelection | undefined {
  if (value === 'all') return value;
  if (value?.startsWith('name:')) {
    const name = pizzaNameKey(value.slice(5));
    if (name && name.length <= 100) return `name:${name}`;
  }
  return undefined;
}
