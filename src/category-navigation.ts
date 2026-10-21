import { categories, categoryCounts, emptyCategoryCounts, rankedCategories, streetfoodPriceCount, type Category } from './categories';
import type { Drink } from './community';
import { t } from './i18n';
import type { PublicMap } from './custom-map-data';

export function categoryNavigation(root: HTMLElement, choose: (drink: Drink) => void, dataPath: string) {
  const labels: Record<Category, string> = { coffee: t('Kaffee'), beer: t('Bier'), pizza: 'Pizza', doner: t('Döner'), falafel: 'Falafel' };
  const upcoming = (category: Category) => category === 'doner' || category === 'falafel';
  root.innerHTML = `<div id="primary-categories" class="switch" role="group" aria-label="${t('Kategorie')}"></div>
    <div class="more-categories"><button id="categories-toggle" type="button" aria-expanded="false" aria-controls="additional-categories" aria-label="${t('Weitere Kategorien')}" title="${t('Weitere Kategorien')}"><span class="more-label">${t('Weitere')}</span><span class="filter-chevron" aria-hidden="true"></span></button>
    <div id="additional-categories" role="group" aria-label="${t('Weitere Kategorien')}" hidden></div></div>`;
  const primary = root.querySelector<HTMLElement>('#primary-categories')!;
  const more = root.querySelector<HTMLElement>('#additional-categories')!;
  const toggle = root.querySelector<HTMLButtonElement>('#categories-toggle')!;
  const moreContainer = root.querySelector<HTMLElement>('.more-categories')!;
  const priceCounts = { doner: 0, falafel: 0 };
  const dialog = document.createElement('dialog');
  dialog.id = 'upcoming-category';
  dialog.setAttribute('aria-labelledby', 'upcoming-category-title');
  dialog.innerHTML = `<h2 id="upcoming-category-title"></h2><p>${t('Für diese Kategorie sind noch keine Preise verfügbar.')}</p><form method="dialog"><button>${t('Schliessen')}</button></form>`;
  root.append(dialog);
  let counts = emptyCategoryCounts(), pizzaAvailable = true, active: Drink = 'coffee';
  let clicked: Category = 'coffee';
  let requestVersion = 0;
  let pendingClicks = Promise.resolve();
  let mapButtons: HTMLButtonElement[] = [], savedMapButtons: HTMLButtonElement[] = [];
  let requestMapButton: HTMLButtonElement | undefined;
  const buttons = Object.fromEntries(categories.map(category => {
    const button = document.createElement('button');
    button.id = `drink-${category}`; button.type = 'button';
    button.setAttribute('aria-label', upcoming(category) ? `${labels[category]} · ${t('Bald verfügbar')}` : labels[category]);
    button.textContent = labels[category];
    if (upcoming(category)) button.title = t('Bald verfügbar');
    button.onclick = () => {
      clicked = category;
      close();
      if (category === 'doner' || category === 'falafel') {
        dialog.querySelector('h2')!.textContent = `${labels[category]} · ${t('Bald verfügbar')}`;
        dialog.showModal();
      } else choose(category);
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
    for (const category of categories) buttons[category].setAttribute('aria-pressed', String(category === active));
    const inMore = more.contains(buttons[active]);
    toggle.setAttribute('aria-pressed', String(inMore));
    toggle.setAttribute('aria-label', inMore ? `${t('Weitere Kategorien')}: ${labels[active]}` : t('Weitere Kategorien'));
  }
  function render() {
    const focused = document.activeElement;
    const order = rankedCategories(counts, pizzaAvailable).filter(category =>
      category !== 'doner' && category !== 'falafel' || priceCounts[category] >= 50);
    for (const category of categories) buttons[category].hidden = !order.includes(category);
    primary.replaceChildren(...order.filter(category => !upcoming(category)).map(category => buttons[category]));
    more.replaceChildren(...order.filter(upcoming).map(category => buttons[category]));
    // Retain the unavailable Pizza element for existing control synchronization.
    if (!pizzaAvailable) more.append(buttons.pizza);
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
    if (requestMapButton) {
      const action = document.createElement('div');
      action.className = 'custom-map-menu-group';
      action.append(requestMapButton); more.append(action);
    }
    moreContainer.hidden = !order.some(upcoming) && !mapButtons.length && !savedMapButtons.length && !requestMapButton;
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
  dialog.addEventListener('close', () => (primary.contains(buttons[clicked]) ? buttons[clicked] : toggle).focus());
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
  // Price availability comes from this city's datasets, independently of click popularity.
  for (const category of ['doner', 'falafel'] as const) {
    void (async () => {
      try {
        const response = await fetch(`${dataPath}${category}.json`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return;
        priceCounts[category] = streetfoodPriceCount(await response.json(), category);
        render();
      } catch { /* Missing or unreadable datasets keep the category hidden. */ }
    })();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  return {
    setAutomaticMapRequest(openRequest: (trigger: HTMLButtonElement) => void) {
      requestMapButton = document.createElement('button');
      requestMapButton.type = 'button';
      requestMapButton.textContent = t('Automatische Map anfragen');
      requestMapButton.onclick = () => { close(); openRequest(toggle); };
      render();
    },
    setCustomMaps(maps: PublicMap[], load: (id: string) => void) {
      mapButtons = [...maps].sort((a, b) => a.name.localeCompare(b.name, 'de-CH')).map(map => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${map.name} · ${t('{count} Lokale', { count: map.venueCount })}`;
        button.dataset.customMap = map.id;
        button.onclick = () => { close(); load(map.id); };
        return button;
      });
      render();
    },
    setSavedMaps(maps: { id: string; name: string }[], load: (id: string) => void) {
      savedMapButtons = maps.map(map => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = map.name; button.dataset.mapName = map.name; button.dataset.customMap = map.id;
        button.onclick = () => { close(); load(map.id); };
        return button;
      });
      render();
    },
    close,
    update(drink: Drink, hasPizza: boolean) {
      active = drink;
      if (pizzaAvailable !== hasPizza) { pizzaAvailable = hasPizza; render(); }
      else syncActive();
    },
  };
}
