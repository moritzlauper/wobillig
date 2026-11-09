import { categories, categoryCounts, categoryPeriod, emptyCategoryCounts, featuredCategories, rankedCategories, type Category } from './categories';
import type { Drink } from './community';
import { t } from './i18n';
import type { PublicMap } from './custom-map-data';

export function categoryNavigation(root: HTMLElement, choose: (drink: Drink) => void) {
  const labels: Record<Category, string> = { coffee: t('Kaffee'), beer: t('Bier'), ramen: t('Ramen'), burger: t('Burger'), softdrink: t('Softdrinks'), cocktail: t('Cocktails'), wine: t('Wein'), pizza: 'Pizza', kebab: t('Kebab & Falafel') };
  root.innerHTML = `<div id="primary-categories" class="switch" role="group" aria-label="${t('Kategorie')}"></div>
    <div class="more-categories"><button id="categories-toggle" type="button" aria-expanded="false" aria-controls="additional-categories" aria-label="${t('Weitere Kategorien')}" title="${t('Weitere Kategorien')}"><span class="more-label">${t('Weitere')}</span><span class="filter-chevron" aria-hidden="true"></span></button>
    <div id="additional-categories" role="group" aria-label="${t('Weitere Kategorien')}" hidden></div></div>`;
  const primary = root.querySelector<HTMLElement>('#primary-categories')!;
  const more = root.querySelector<HTMLElement>('#additional-categories')!;
  const toggle = root.querySelector<HTMLButtonElement>('#categories-toggle')!;
  const moreContainer = root.querySelector<HTMLElement>('.more-categories')!;
  let counts = emptyCategoryCounts(), unavailable: ReadonlySet<Category> = new Set(), active: Drink = 'coffee';
  let requestVersion = 0;
  let pendingClicks = Promise.resolve();
  let mapButtons: HTMLButtonElement[] = [], savedMapButtons: HTMLButtonElement[] = [];
  // A category outside the price data, such as the apartment map: it sits in the menu like the others.
  let extraButton: HTMLButtonElement | undefined, extraActive = false;
  const leaveListeners: (() => void)[] = [];
  const leave = () => { for (const listener of leaveListeners) listener(); };
  let createButton: HTMLButtonElement | undefined;
  const buttons = Object.fromEntries(categories.map(category => {
    const button = document.createElement('button');
    button.id = `drink-${category}`; button.type = 'button';
    button.setAttribute('aria-label', labels[category]);
    button.textContent = labels[category];
    button.onclick = () => {
      close();
      leave();
      choose(category);
      // Serialize responses so a slower earlier click cannot undo a newer ranking.
      ++requestVersion;
      pendingClicks = pendingClicks.then(async () => {
        try {
          const response = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }), signal: AbortSignal.timeout(8000) });
          if (!response.ok) return;
          const result = await response.json();
          if (!result.counts) return;
          counts = categoryCounts(result.counts);
          if (more.hidden) render();
        } catch { /* Category selection works even when shared statistics are unavailable. */ }
      });
    };
    return [category, button];
  })) as Record<Category, HTMLButtonElement>;

  function syncActive() {
    for (const category of categories) buttons[category].setAttribute('aria-pressed', String(!extraActive && category === active));
    extraButton?.setAttribute('aria-pressed', String(extraActive));
    const current = extraActive && extraButton ? extraButton : buttons[active];
    const inMore = more.contains(current);
    toggle.setAttribute('aria-pressed', String(inMore));
    toggle.setAttribute('aria-label', inMore ? `${t('Weitere Kategorien')}: ${current.textContent}` : t('Weitere Kategorien'));
  }
  function render() {
    const focused = document.activeElement;
    const order = rankedCategories(counts, unavailable);
    // Only the featured categories stay in the row; every other category, new ones included, sits behind "Weitere".
    const featured = featuredCategories(counts, order, categoryPeriod());
    const collapsed = (category: Category) => !featured.includes(category);
    for (const category of categories) buttons[category].hidden = !order.includes(category);
    primary.replaceChildren(...featured.map(category => buttons[category]));
    more.replaceChildren(...order.filter(collapsed).map(category => buttons[category]));
    // Retain the unavailable Pizza element for existing control synchronization.
    if (unavailable.has('pizza')) more.append(buttons.pizza);
    if (extraButton) more.append(extraButton);
    const savedIds = new Set(savedMapButtons.map(button => button.dataset.customMap));
    const publicButtons = mapButtons.filter(button => !savedIds.has(button.dataset.customMap));
    const publicIds = new Set(mapButtons.map(button => button.dataset.customMap));
    for (const button of savedMapButtons) {
      button.textContent = button.dataset.mapName! + (publicIds.has(button.dataset.customMap) ? ` · ${t('Community-Map')}` : '');
    }
    for (const [label, items] of [[t('Meine Maps'), savedMapButtons], [t('Community-Maps'), publicButtons]] as const) {
      if (!items.length) continue;
      const group = document.createElement('div');
      group.className = 'custom-map-menu-group';
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
      const heading = document.createElement('div');
      heading.className = 'custom-map-menu-label'; heading.textContent = label;
      group.append(heading, ...items); more.append(group);
    }
    if (createButton) more.append(createButton);
    moreContainer.hidden = !order.some(collapsed) && !extraButton && !mapButtons.length && !savedMapButtons.length && !createButton;
    if (moreContainer.hidden) {
      more.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
    syncActive();
    if (focused instanceof HTMLButtonElement && categories.some(category => buttons[category] === focused)) {
      (more.contains(focused) && more.hidden ? toggle : focused).focus({ preventScroll: true });
    }
  }
  function close() {
    more.hidden = true; toggle.setAttribute('aria-expanded', 'false'); render();
  }
  function open() {
    if (moreContainer.hidden) return;
    more.hidden = false; toggle.setAttribute('aria-expanded', 'true');
  }
  toggle.onclick = () => more.hidden ? open() : close();
  toggle.onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); more.querySelector<HTMLButtonElement>('button:not([hidden])')?.focus(); }
  };
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !more.hidden) { event.preventDefault(); close(); toggle.focus(); }
  });
  document.addEventListener('pointerdown', event => { if (!more.hidden && !root.contains(event.target as Node)) close(); });
  root.addEventListener('focusout', event => { if (!more.hidden && event.relatedTarget && !root.contains(event.relatedTarget as Node)) close(); });
  async function refresh() {
    const version = ++requestVersion;
    try {
      await pendingClicks;
      const response = await fetch('/api/categories', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const result = await response.json();
      if (version !== requestVersion || !result.counts) return;
      counts = categoryCounts(result.counts);
      if (more.hidden) render();
    } catch { /* The default order remains usable offline. */ }
  }
  render();
  void refresh();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  return {
    setCustomMaps(maps: PublicMap[], load: (id: string) => void) {
      mapButtons = [...maps].sort((a, b) => a.name.localeCompare(b.name, 'de-CH')).map(map => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${map.name} · ${map.venueCount === 1 ? t('1 Lokal') : t('{count} Lokale', { count: map.venueCount })}`;
        button.dataset.customMap = map.id;
        button.onclick = () => { close(); leave(); load(map.id); };
        return button;
      });
      render();
    },
    setSavedMaps(maps: { id: string; name: string }[], load: (id: string) => void) {
      savedMapButtons = maps.map(map => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = map.name; button.dataset.mapName = map.name; button.dataset.customMap = map.id;
        button.onclick = () => { close(); leave(); load(map.id); };
        return button;
      });
      render();
    },
    setExtraCategory(button: HTMLButtonElement, choose: () => void) {
      extraButton = button;
      button.onclick = () => { close(); choose(); };
      render();
    },
    setExtraActive(value: boolean) { extraActive = value; syncActive(); },
    // Runs before another category or map takes over from the extra category.
    onLeave(listener: () => void) { leaveListeners.push(listener); },
    close,
    setCreateButton(button: HTMLButtonElement) {
      createButton = button;
      button.addEventListener('click', () => close());
      render();
    },
    // After the map dialog closes, focus returns to the menu the button sits in.
    focusMenu() { toggle.focus(); },
    // Categories without enough current prices in this city stay hidden.
    update(drink: Drink, hidden: ReadonlySet<Category>) {
      active = drink;
      if (hidden.size !== unavailable.size || [...hidden].some(category => !unavailable.has(category))) { unavailable = new Set(hidden); render(); }
      else syncActive();
    },
  };
}
