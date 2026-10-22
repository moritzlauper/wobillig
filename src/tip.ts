import type { PaymentIntent, Stripe } from '@stripe/stripe-js';
import type { City } from './cities';
import { locale, t } from './i18n';

// Remove Stripe's return credentials before analytics, map links or filters use the URL.
const returnedUrl = new URL(window.location.href);
let returnedSecret = returnedUrl.searchParams.get('payment_intent_client_secret');
if (returnedSecret) {
  for (const key of ['payment_intent_client_secret', 'payment_intent', 'redirect_status']) returnedUrl.searchParams.delete(key);
  history.replaceState(history.state, '', returnedUrl);
}

function paymentMessage(intent?: PaymentIntent): string {
  if (intent?.status === 'succeeded') return t('Danke für deinen Beitrag an die Plattformkosten!');
  if (intent?.status === 'processing') return t('Deine Zahlung wird verarbeitet. Vielen Dank!');
  return t('Die Zahlung wurde nicht abgeschlossen. Du kannst es erneut versuchen.');
}

async function paymentDialog(stripe: Stripe, clientSecret: string, price: string, test: boolean) {
  const overlay = document.createElement('div');
  overlay.className = 'tip-backdrop'; overlay.hidden = true;
  const dialog = document.createElement('dialog');
  dialog.id = 'tip-dialog';
  dialog.setAttribute('aria-labelledby', 'tip-title');
  // All dynamic copy uses textContent; payment details stay inside Stripe's iframe.
  dialog.innerHTML = '<div class="dialog-top"><strong id="tip-title">wobillig</strong><button type="button" class="tip-close"></button></div><p class="tip-description"></p><form><div class="tip-element"></div><button class="primary tip-pay" type="submit" disabled></button></form><p class="tip-status" role="status" tabindex="-1"></p>';
  const close = dialog.querySelector<HTMLButtonElement>('.tip-close')!;
  close.textContent = t('Schliessen');
  dialog.querySelector('.tip-description')!.textContent = t('Beitrag an die Plattformkosten in der Höhe eines günstigen Cappuccinos · CHF {price}', { price }) + (test ? ` (${t('Test')})` : '');
  const form = dialog.querySelector('form')!;
  const pay = dialog.querySelector<HTMLButtonElement>('.tip-pay')!;
  pay.textContent = t('CHF {price} bezahlen', { price });
  const status = dialog.querySelector<HTMLElement>('.tip-status')!;
  status.textContent = t('Zahlung wird geladen …');
  const elements = stripe.elements({ clientSecret, locale: locale(), appearance: {
    theme: 'stripe', variables: { colorPrimary: '#262626', borderRadius: '4px', fontFamily: 'Arial, sans-serif' },
  } });
  const payment = elements.create('payment', {
    business: { name: 'wobillig' }, layout: 'tabs', paymentMethodOrder: ['twint', 'card'],
    wallets: { link: 'never' },
    // TWINT and card need no email. Auto collects only fields required by the method.
    fields: { billingDetails: { address: 'if_required' } },
  });
  let paying = false;
  close.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (paying) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // Switching modal/non-modal for Stripe's authentication overlay.
    payment.destroy(); dialog.remove(); overlay.remove();
  });
  payment.on('ready', () => { status.textContent = ''; pay.disabled = false; });
  payment.on('loaderror', () => { status.textContent = t('Die Zahlung konnte nicht geöffnet werden. Bitte später erneut versuchen.'); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (paying || pay.disabled) return;
    paying = true; pay.disabled = true; close.disabled = true;
    status.textContent = t('Zahlung wird verarbeitet …');
    // Stripe mounts bank authentication outside our dialog. Leave the browser's
    // top layer while confirming so its 3-D Secure frame stays visible and usable.
    overlay.hidden = false; dialog.close(); dialog.show();
    try {
      const result = await stripe.confirmPayment({ elements,
        confirmParams: { return_url: window.location.href }, redirect: 'if_required' });
      if (result.error) status.textContent = result.error.message || t('Die Zahlung wurde nicht abgeschlossen. Du kannst es erneut versuchen.');
      else {
        status.textContent = paymentMessage(result.paymentIntent);
        if (['succeeded', 'processing'].includes(result.paymentIntent.status)) form.hidden = true;
      }
    } catch { status.textContent = t('Die Zahlung wurde nicht abgeschlossen. Du kannst es erneut versuchen.'); }
    finally {
      dialog.close(); dialog.showModal(); overlay.hidden = true;
      paying = false; pay.disabled = false; close.disabled = false; status.focus();
    }
  };
  document.body.append(overlay, dialog);
  dialog.showModal();
  payment.mount(dialog.querySelector<HTMLElement>('.tip-element')!);
}

export async function setupTip(button: HTMLButtonElement, city: City, notify: (text: string) => void) {
  const params = new URLSearchParams({ city, locale: locale() });
  try {
    const response = await fetch(`/api/tip?${params}`);
    if (!response.ok) return;
    const quote = await response.json() as { enabled?: boolean; amount?: number; test?: boolean; publishableKey?: string };
    if (!quote.enabled || !quote.publishableKey?.startsWith('pk_') || !Number.isInteger(quote.amount) || quote.amount! < 100 || quote.amount! > 2000) return;
    const price = (quote.amount! / 100).toFixed(2);
    const label = t('Plattformkosten stützen · CHF {price}', { price });
    button.textContent = quote.test ? `${label} (${t('Test')})` : label;
    button.title = t('Der Betrag entspricht einem Cappuccino zum «Günstig»-Preis dieser Stadt und hilft, die Plattformkosten zu decken.');
    button.hidden = false;
    const getStripe = async () => {
      const { loadStripe } = await import('@stripe/stripe-js/pure');
      const stripe = await loadStripe(quote.publishableKey!);
      if (!stripe) throw new Error('Stripe unavailable');
      return stripe;
    };
    if (returnedSecret) {
      const secret = returnedSecret; returnedSecret = null;
      try {
        const result = await (await getStripe()).retrievePaymentIntent(secret);
        if (result.error) throw new Error('Payment status unavailable');
        notify(paymentMessage(result.paymentIntent));
      } catch { notify(t('Der Zahlungsstatus konnte nicht geladen werden. Bitte vor einer erneuten Zahlung in TWINT oder bei deiner Bank prüfen.')); }
    }
    params.set('amount', String(quote.amount));
    button.onclick = async () => {
      if (button.disabled || document.getElementById('tip-dialog')) return;
      button.disabled = true;
      try {
        const response = await fetch(`/api/tip?${params}`, { method: 'POST' });
        if (response.status === 409) {
          notify(t('Der Cappuccino-Preis hat sich geändert und damit auch der Betrag. Bitte erneut wählen.'));
          await setupTip(button, city, notify); return;
        }
        if (!response.ok) throw new Error('Payment unavailable');
        const { clientSecret } = await response.json() as { clientSecret?: string };
        if (!clientSecret || !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(clientSecret)) throw new Error('Invalid payment');
        await paymentDialog(await getStripe(), clientSecret, price, !!quote.test);
      } catch { notify(t('Die Zahlung konnte nicht geöffnet werden. Bitte später erneut versuchen.')); }
      finally { button.disabled = false; }
    };
  } catch { /* Keep the optional tip hidden if payments are unavailable. */ }
}

// Invite only after the map operation has succeeded; dismissing never changes it.
export function offerTip(context: 'automatic' | 'publication', mapId: string) {
  const button = document.querySelector<HTMLButtonElement>('#tip-coffee');
  if (!button || button.hidden || button.disabled || document.querySelector('#tip-invitation, #tip-dialog')) return;
  const key = `wobillig:tip-invitation:${context}:${mapId}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* Optional invitation works without storage. */ }
  const dialog = document.createElement('dialog');
  dialog.id = 'tip-invitation'; dialog.setAttribute('aria-labelledby', 'tip-invitation-title');
  dialog.innerHTML = '<div class="dialog-top"><strong id="tip-invitation-title"></strong><button type="button" class="tip-dismiss"></button></div><p></p><button type="button" class="primary tip-accept"></button>';
  dialog.querySelector('strong')!.textContent = context === 'automatic' ? t('Deine Anfrage ist eingereicht.') : t('Deine Map ist zur Prüfung eingereicht.');
  dialog.querySelector('p')!.textContent = t('Magst du die Plattformkosten von wobillig mit dem Preis eines günstigen Cappuccinos stützen? Der Beitrag ist freiwillig und hat keinen Einfluss auf die Prüfung.');
  const dismiss = dialog.querySelector<HTMLButtonElement>('.tip-dismiss')!;
  dismiss.textContent = t('Nicht jetzt'); dismiss.onclick = () => dialog.close();
  const accept = dialog.querySelector<HTMLButtonElement>('.tip-accept')!;
  accept.textContent = button.textContent;
  accept.onclick = () => { dialog.close(); button.click(); };
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal();
}
