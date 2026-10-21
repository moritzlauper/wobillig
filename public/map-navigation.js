// Keep the static language link usable before the map and its data finish loading.
(() => {
  function update() {
    const link = document.querySelector('.seo-map-header [data-locale]');
    if (!link) return;
    const params = new URLSearchParams(location.search);
    for (const key of ['payment_intent', 'payment_intent_client_secret', 'redirect_status']) params.delete(key);
    link.search = params.toString();
  }
  document.addEventListener('DOMContentLoaded', update);
  document.addEventListener('click', event => {
    if (event.target.closest?.('.seo-map-header [data-locale]')) update();
  });
})();
