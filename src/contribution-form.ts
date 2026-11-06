import type { City } from './cities';
import type { Bar } from './data';
import { t } from './i18n';
import { contributionVenues, parseContribution, type ContributionDraft } from './smart-contribution';

export type ContributionMode = 'smart' | 'manual' | 'scan';
export function contributionNotes(draft: ContributionDraft): string[] {
  const labels = {
    price: t('Bitte den eindeutigen Preis im Formular ergänzen.'),
    product: t('Bitte Produkt und Sorte im Formular ergänzen.'),
    pizza: t('Hier werden ganze, normale Margheritas erfasst. Bitte Sorte und Portion prüfen.'),
    portion: t('Bitte die genaue Portion im Formular ergänzen.'),
    special: t('Aktions-, Menü- und Take-away-Preise sind nicht direkt vergleichbar. Bitte den regulären Einzelpreis prüfen.'),
    multiple: t('Bitte pro Eintrag ein Produkt mit seinem Einzelpreis erfassen.'),
  };
  return draft.notes.map(note => labels[note]);
}

export function contributionForm(city: City, known: () => Bar[], proceed: (bar: Bar, mode: ContributionMode, draft?: ContributionDraft) => void,
  addVenue: (name: string, chosen: (bar: Bar) => void) => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'contribution-dialog'; dialog.setAttribute('aria-labelledby', 'contribution-title');
  dialog.innerHTML = `
    <div class="dialog-top"><strong id="contribution-title" tabindex="-1">${t('Preise ergänzen')}</strong><button id="contribution-close" type="button">${t('Schliessen')}</button></div>
    <div id="contribution-start">
      <!-- A photo of the menu or receipt is the quickest way to add many prices, so it comes first. -->
      <button id="contribution-scan" class="contribution-option contribution-recommended" type="button"><strong>${t('Menükarte oder Quittung hochladen')}</strong><span>${t('Lokal wählen, dann fotografieren oder ein Foto auswählen. Alle lesbaren Preise werden gespeichert.')}</span></button>
      <form id="contribution-smart" class="contribution-smart">
        <label for="contribution-text">${t('Smart ergänzen')}</label>
        <p class="muted" id="contribution-help">${t('Schreib, was wie viel kostet und wo. Du prüfst den Eintrag vor dem Speichern.')}</p>
        <textarea id="contribution-text" rows="3" maxlength="500" required aria-describedby="contribution-help" placeholder="${t('z. B. Food Court am HB, Pizza Margherita für 5.–')}"></textarea>
        <button type="submit" class="primary">${t('Eintrag vorbereiten')}</button>
      </form>
      <button id="contribution-manual" class="text-button" type="button">${t('Manuell eintragen')}</button>
    </div>
    <section id="contribution-venue" hidden aria-labelledby="contribution-venue-title">
      <button id="contribution-back" class="text-button" type="button">${t('Zurück')}</button>
      <h2 id="contribution-venue-title" tabindex="-1">${t('Welches Lokal?')}</h2>
      <p id="contribution-preview" class="contribution-preview"></p>
      <p id="contribution-notes" class="muted"></p>
      <label for="contribution-query">${t('Lokal oder Adresse')}</label>
      <input id="contribution-query" type="search" maxlength="160" autocomplete="off" aria-controls="contribution-matches">
      <p id="contribution-status" class="muted" role="status"></p>
      <div id="contribution-matches"></div>
    </section>
    <div class="contribution-new"><span class="muted">${t('Dein Lokal fehlt?')}</span><button id="contribution-new" class="text-button" type="button">${t('Neues Lokal erfassen')}</button></div>`;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#contribution-${id}`)!;
  let mode: ContributionMode = 'manual', draft: ContributionDraft | undefined;
  let choosing = false;
  const complete = (bar: Bar) => {
    dialog.close();
    proceed(bar, mode, mode === 'smart' ? parseContribution(el<HTMLTextAreaElement>('text').value, city, bar) : undefined);
  };
  function matches(useSentence = false) {
    const value = el<HTMLInputElement>('query').value;
    const choices = contributionVenues(known(), useSentence && draft ? draft.text : value, value);
    el('matches').replaceChildren();
    el('status').textContent = choices.length ? t('Wähle das passende Lokal mit Adresse.')
      : value.trim() ? t('Kein passendes Lokal gefunden. Ändere die Suche oder erfasse ein neues Lokal.') : t('Suche nach dem Namen oder der Adresse des Lokals.');
    for (const bar of choices) {
      const button = document.createElement('button'); button.type = 'button';
      const name = document.createElement('strong'); name.textContent = bar.name;
      const address = document.createElement('span'); address.textContent = [bar.address, bar.postcode].filter(Boolean).join(' · ') || t('Adresse nicht angegeben');
      button.append(name, address); button.onclick = () => complete(bar); el('matches').append(button);
    }
  }
  function choose(next: ContributionMode) {
    mode = next; choosing = true;
    draft = next === 'smart' ? parseContribution(el<HTMLTextAreaElement>('text').value, city) : undefined;
    el('start').hidden = true; el('venue').hidden = false;
    el('preview').textContent = draft ? [draft.fields.name, draft.fields.priceChf !== undefined ? `CHF ${draft.fields.priceChf.toFixed(2)}` : ''].filter(Boolean).join(' · ') || draft.text
      : next === 'scan' ? t('Die Menükarte wird dem gewählten Lokal zugeordnet.') : t('Anschliessend kannst du den Preis eintragen.');
    el('notes').textContent = draft ? contributionNotes(draft).join(' ') : '';
    el<HTMLInputElement>('query').value = draft ? draft.venueQuery : el<HTMLTextAreaElement>('text').value.trim();
    matches(true); el('venue-title').focus();
  }
  el<HTMLFormElement>('smart').onsubmit = event => { event.preventDefault(); choose('smart'); };
  el('scan').onclick = () => choose('scan');
  el('manual').onclick = () => choose('manual');
  el('query').oninput = () => matches();
  el('close').onclick = () => dialog.close();
  el('back').onclick = () => { choosing = false; el('start').hidden = false; el('venue').hidden = true; el('title').focus(); };
  el('new').onclick = () => {
    if (!choosing) {
      mode = el<HTMLTextAreaElement>('text').value.trim() ? 'smart' : 'manual';
      draft = mode === 'smart' ? parseContribution(el<HTMLTextAreaElement>('text').value, city) : undefined;
    }
    const name = choosing ? el<HTMLInputElement>('query').value : draft?.venueQuery || '';
    dialog.close(); addVenue(name, complete);
  };
  return {
    open(text = '') {
      el<HTMLTextAreaElement>('text').value = text; draft = undefined; mode = 'manual'; choosing = false;
      el('start').hidden = false; el('venue').hidden = true;
      dialog.showModal(); el('title').focus();
    },
    resume() { dialog.showModal(); el('title').focus(); },
  };
}
