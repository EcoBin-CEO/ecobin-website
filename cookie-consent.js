(function () {
  const KEY = "ecobin_cookie_consent"; // "all" | "necessary"

  const banner = document.getElementById("cookie-banner");
  const mapIframe = document.getElementById("map-iframe");
  const mapPlaceholder = document.getElementById("map-placeholder");
  const mapLoadBtn = document.getElementById("map-load-btn");
  const acceptAllBtn = document.getElementById("cookie-accept-all");
  const acceptNecessaryBtn = document.getElementById("cookie-accept-necessary");
  const settingsLink = document.getElementById("cookie-settings-open");

  function readConsent() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (e) {
      /* z. B. Privatmodus – Auswahl gilt dann nur für diese Sitzung */
    }
  }

  function loadMap() {
    if (mapIframe && !mapIframe.src) {
      mapIframe.src = mapIframe.dataset.src;
      mapIframe.hidden = false;
      if (mapPlaceholder) mapPlaceholder.hidden = true;
    }
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function showBanner() {
    if (banner) banner.hidden = false;
  }

  function applyConsent(value) {
    writeConsent(value);
    hideBanner();
    if (value === "all") loadMap();
  }

  // Beim Laden: gespeicherte Wahl anwenden, sonst Banner zeigen
  const saved = readConsent();
  if (saved === "all") {
    loadMap();
  } else if (saved !== "necessary") {
    showBanner();
  }

  acceptAllBtn?.addEventListener("click", () => applyConsent("all"));
  acceptNecessaryBtn?.addEventListener("click", () => applyConsent("necessary"));
  // Karte lässt sich auch ohne "Alle akzeptieren" gezielt manuell laden
  mapLoadBtn?.addEventListener("click", loadMap);
  // Einstellungen im Footer erlauben, die Wahl jederzeit zu ändern
  settingsLink?.addEventListener("click", showBanner);
})();
