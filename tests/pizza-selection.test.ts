import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pizzaGroup } from '../src/pizza-selection';
import { pizzaVarieties, type Dataset } from '../src/data';

describe('ingredient-based pizza classics', () => {
  it.each([
    ['Ortolana', 'Pomodoro, mozzarella, verdure di stagione', 'vegetariana'],
    ['Giardino', 'Tomaten, Mozzarella, Auberginen, Zucchetti', 'vegetariana'],
    ['Amalfi Vegan', 'Tomatensauce, Zwiebeln, Aubergine, Zucchini, Kartoffeln', 'vegetariana'],
    ['Vegetariana', 'Verschiedenes Gemüse, Oregano', 'vegetariana'],
    ['Estate', 'Mozzarella, Peperoni, Pilze', 'vegetariana'],
    ['Bosco', 'Tomaten, Mozzarella, Champignons', 'funghi'],
    ['Della casa', 'Pomodoro, mozzarella, prosciutto cotto', 'prosciutto'],
    ['019 Proscuitto e Funghi', 'Tomaten, Mozzarella, Hinterschinken, Champignons', 'prosciutto_funghi'],
    ['Capricciosa', 'Pomodoro, mozzarella, prosciutto cotto, carciofi, funghi, olive', 'quattro_stagioni'],
    ['4 Stagioni', 'Hinterschinken, Champignons, Artischocken, pikante Salami', 'quattro_stagioni'],
    ['Calabrese', 'Pomodoro, mozzarella, salame piccante', 'diavola'],
    ['Milano', 'Tomaten, Mozzarella, Salami', 'salami'],
    ['Salami (scharf)', 'Tomaten, Mozzarella, Salami', 'diavola'],
    ['Pugliese', 'Tomaten, Mozzarella, Thon, Zwiebeln, Kapern', 'tonno'],
    ['Formaggio della casa', 'Mozzarella, Gorgonzola, Taleggio, Parmesan', 'quattro_formaggi'],
    ['4-Formaggi', 'Vier verschiedene Käsesorten', 'quattro_formaggi'],
    ['Prosciutto', 'Tomaten, Mozzarella, Pilze', 'funghi'],
  ])('groups %s by its toppings', (name, ingredients, expected) => {
    expect(pizzaGroup({ name, ingredients, pizzaType: 'other' })).toBe(expected);
  });

  it.each([
    ['Margherita', 'Tomaten, Mozzarella, Basilikum'],
    ['Rucola', 'Tomaten, Mozzarella, Rucola'],
    ['Vegetariana', 'Tomaten, Mozzarella, Auberginen, Zucchini, Schinken'],
    ['Ortolana', 'Pomodoro, mozzarella, melanzane, zucchine, acciughe'],
    ['Mare', 'Tomaten, Mozzarella, Pilze, Meeresfrüchten'],
    ['Hawaii', 'Tomaten, Mozzarella, Schinken, Ananas'],
    ['Parma', 'Tomaten, Mozzarella, Rohschinken, Rucola'],
    ['Funghi e tartufo', 'Fiordilatte, funghi, olio al tartufo'],
    ['Pollo', 'Mozzarella, Pouletfleisch, Pilze'],
    ['Gorgonzola', 'Tomaten, Mozzarella, Gorgonzola'],
    ['Fiorentina', 'Tomaten, Mozzarella, Spinat, Ei'],
    ['Fantasia', 'Tomaten, Mozzarella'],
  ])('does not put %s in an unsuitable classic', (name, ingredients) => {
    expect(pizzaGroup({ name, ingredients, pizzaType: 'other' })).toBeUndefined();
  });

  it('falls back only to recognizable names when ingredients are missing', () => {
    for (const name of ['4 Formaggi', '4-FORMAGGI', 'Pizza Quattro Formaggi', 'Al Quattro Formaggi']) {
      expect(pizzaGroup({ name, pizzaType: 'other' })).toBe('quattro_formaggi');
    }
    expect(pizzaGroup({ name: 'Ortolana', pizzaType: 'other' })).toBe('vegetariana');
    expect(pizzaGroup({ name: 'Prosciutto & Funghi', pizzaType: 'other' })).toBe('prosciutto_funghi');
    expect(pizzaGroup({ name: 'La sorpresa', pizzaType: 'other' })).toBeUndefined();
    expect(pizzaGroup({ name: 'Prosciutto', pizzaType: 'margherita' })).toBeUndefined();
  });

  it.each(['', 'basel/', 'bern/'])('keeps the %s city menu to ten classics including Margherita', city => {
    const data = JSON.parse(readFileSync(`public/data/${city}pizza.json`, 'utf8')) as Dataset;
    const options = pizzaVarieties(data.bars);
    expect(options.length).toBeLessThanOrEqual(9);
    expect(options.map(option => option.value)).toEqual(expect.arrayContaining([
      'group:vegetariana', 'group:funghi', 'group:prosciutto', 'group:quattro_stagioni',
    ]));
  });
});
