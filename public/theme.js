// Run in the head before rendering, including on the static price guides.
(() => {
  const key = 'wobillig-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const preference = value => value === 'light' || value === 'dark' ? value : 'system';
  let selected = 'system';
  try { selected = preference(localStorage.getItem(key)); } catch { /* Storage may be blocked. */ }
  function apply() {
    const dark = selected === 'dark' || (selected === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191d22' : '#ffffff');
    const control = document.getElementById('theme-select');
    if (control) control.value = selected;
  }
  apply();
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      selected = preference(event.newValue);
      apply();
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.getElementById('theme-select');
    if (!control) return;
    control.closest('.theme-control').hidden = false;
    control.value = selected;
    control.addEventListener('change', () => {
      selected = preference(control.value);
      try {
        if (selected === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, selected);
      } catch { /* The choice still works for this page. */ }
      apply();
    });
  });
})();
