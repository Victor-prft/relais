// Chargé dans <head> avant le CSS rendu : évite le flash du mauvais thème.
// (Fichier externe car la CSP interdit les scripts en ligne.)
try {
  const theme = localStorage.getItem('relais.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* rien : thème du système */
}
