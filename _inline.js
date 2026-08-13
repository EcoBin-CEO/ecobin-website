
(function () {
  const WORKER_URL = "https://ecobin.mikaback777.workers.dev";
  const TOKEN_KEY = "ecobin_verwaltung_token";
  const USER_KEY = "ecobin_verwaltung_user";
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let bookings = [];

  const TEST_ACTIONS_KEY = "ecobin_verwaltung_test_actions";
  const loginScreen = document.getElementById("login-screen");
  const app = document.getElementById("app");
  const loginBtn = document.getElementById("login-btn");
  const userInput = document.getElementById("login-user");
  const passInput = document.getElementById("login-pass");
  const loginError = document.getElementById("login-error");

  const PAGE_TITLES = {
    dashboard: ["Dashboard", "Überblick über Buchungen, Umsatz und offene Aufgaben"],
    kalender: ["Kalender", "Terminübersicht der geplanten Reinigungen – Wochen- oder Monatsansicht."],
    postfach: ["Postfach", "Nachrichten und Kundenanfragen"],
    abos: ["Monatsabos", "Laufende und beendete Abonnements"],
    kunden: ["Kunden", "Alle Kundendatensätze"],
    einstellungen: ["Einstellungen", "Konto- und Systemeinstellungen"],
  };

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function formatDateDe(d) {
    if (!d) return "–";
    try { return new Date(d + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (_) { return d; }
  }
  function formatDateTimeDe(iso) {
    if (!iso) return "–";
    try {
      const dt = new Date(iso);
      return dt.toLocaleDateString("de-DE") + ", " + dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    } catch (_) { return iso; }
  }
  function formatEuro(n) {
    if (n === null || n === undefined || isNaN(n)) return "–";
    return Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function initialsOf(str) {
    str = (str || "").trim();
    if (!str) return "EB";
    const namePart = str.includes("@") ? str.split("@")[0] : str;
    const words = namePart.replace(/[._-]+/g, " ").trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return namePart.slice(0, 2).toUpperCase();
  }

  async function api(path, opts) {
    const options = Object.assign({ cache: "no-store" }, opts || {});
    options.headers = Object.assign({ "Authorization": "Bearer " + token }, options.headers || {});
    const res = await fetch(WORKER_URL + path, options);
    let data = {};
    try { data = await res.json(); } catch (_) { data = {}; }
    if (res.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      token = "";
      showLogin(true);
      throw new Error(data.error || "Nicht autorisiert");
    }
    if (!res.ok) {
      throw new Error(data.error || ("HTTP " + res.status));
    }
    return data;
  }

  function showLogin(withError) {
    app.style.display = "none";
    loginScreen.style.display = "flex";
    loginError.style.display = withError ? "block" : "none";
    loginBtn.disabled = false;
    loginBtn.textContent = "Anmelden";
  }

  function showApp() {
    loginScreen.style.display = "none";
    app.style.display = "block";
    const displayName = sessionStorage.getItem(USER_KEY) || "Admin";
    document.getElementById("user-avatar").textContent = initialsOf(displayName);
    document.getElementById("user-name").textContent = displayName.includes("@") ? displayName.split("@")[0] : displayName;
    document.getElementById("user-email").textContent = displayName;
    loadDashboard();
  }

  loginBtn.addEventListener("click", async () => {
    const user = userInput.value.trim();
    const pass = passInput.value;
    if (!pass) { loginError.textContent = "Bitte Passwort/Token eingeben."; loginError.style.display = "block"; return; }
    token = pass;
    loginBtn.disabled = true;
    loginBtn.textContent = "Wird geprüft …";
    try {
      const test = await api("/api/admin/bookings?status=pending");
      if (Array.isArray(test)) {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(USER_KEY, user || "Admin");
        showApp();
      } else {
        throw new Error("unexpected");
      }
    } catch (e) {
      loginError.textContent = "Anmeldung fehlgeschlagen. Bitte Passwort/Token prüfen.";
      loginError.style.display = "block";
      loginBtn.disabled = false;
      loginBtn.textContent = "Anmelden";
    }
  });
  [userInput, passInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); }));

  document.getElementById("logout-btn").addEventListener("click", () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    token = "";
    showLogin(false);
  });

  document.getElementById("refresh-btn").addEventListener("click", loadDashboard);

  // Navigation
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => switchTab(el.dataset.tab));
  });
  function switchTab(tab) {
    document.querySelectorAll(".sb-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const [title, sub] = PAGE_TITLES[tab] || ["Dashboard", ""];
    document.getElementById("page-title").textContent = title;
    document.getElementById("page-sub").textContent = sub;
    const namedViews = ["dashboard", "postfach", "kalender", "abos", "kunden", "einstellungen"];
    document.getElementById("view-dashboard").style.display = tab === "dashboard" ? "block" : "none";
    document.getElementById("view-postfach").style.display = tab === "postfach" ? "block" : "none";
    document.getElementById("view-kalender").style.display = tab === "kalender" ? "block" : "none";
    document.getElementById("view-abos").style.display = tab === "abos" ? "block" : "none";
    document.getElementById("view-kunden").style.display = tab === "kunden" ? "block" : "none";
    document.getElementById("view-einstellungen").style.display = tab === "einstellungen" ? "block" : "none";
    document.getElementById("view-kunde-detail").style.display = "none";
    document.getElementById("view-kunden-detail").style.display = "none";
    if (!namedViews.includes(tab)) {
      document.getElementById("view-placeholder").style.display = "block";
      document.getElementById("placeholder-title").textContent = title;
    } else {
      document.getElementById("view-placeholder").style.display = "none";
    }
    if (tab === "kalender") renderCalendar();
    if (tab === "abos") renderAbos();
    if (tab === "kunden") renderKundenTable();
    if (tab === "einstellungen") renderEinstellungen();
  }

  // ---------- Einstellungen ----------
  const SETTINGS_KEY = "ecobin_verwaltung_settings";
  const DEFAULT_SETTINGS = {
    firmenname: "EcoBin",
    ansprechpartner: "",
    email: "",
    telefon: "",
    website: "",
    absender: "EcoBin-Team",
    adresse: "",
    impressum: "",
    signatur: "Viele Grüße\nIhr EcoBin-Team",
  };
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (_) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }
  function saveSettings(values) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(values));
  }
  const ST_FIELDS = {
    firmenname: "st-firmenname",
    ansprechpartner: "st-ansprechpartner",
    email: "st-email",
    telefon: "st-telefon",
    website: "st-website",
    absender: "st-absender",
    adresse: "st-adresse",
    impressum: "st-impressum",
    signatur: "st-signatur",
  };
  function renderEinstellungen() {
    const settings = loadSettings();
    Object.keys(ST_FIELDS).forEach((key) => {
      const el = document.getElementById(ST_FIELDS[key]);
      if (el) el.value = settings[key] || "";
    });
    loadPreise();
    loadDiscountCodes();
    loadEmailVorlagen();
  }
  document.querySelectorAll("[data-settings-toggle]").forEach((head) => {
    head.addEventListener("click", () => {
      const tile = document.getElementById(head.dataset.settingsToggle);
      if (tile) tile.classList.toggle("open");
    });
  });
  const stSaveBtn = document.getElementById("st-save-btn");
  if (stSaveBtn) {
    stSaveBtn.addEventListener("click", () => {
      const values = {};
      Object.keys(ST_FIELDS).forEach((key) => {
        const el = document.getElementById(ST_FIELDS[key]);
        values[key] = el ? el.value.trim() : "";
      });
      saveSettings(values);
      const msg = document.getElementById("st-save-msg");
      if (msg) {
        msg.classList.add("show");
        clearTimeout(stSaveBtn._msgTimeout);
        stSaveBtn._msgTimeout = setTimeout(() => msg.classList.remove("show"), 2500);
      }
    });
  }

  // ---------- Testdaten ----------
  function buildTestEmail(b, action) {
    const name=b.name||"Testkunde", date=formatDateDe(b.date), kind=b.abo?"Monatsabo":"Buchung";
    let subject="EcoBin – ", body="Hallo "+name+",\n\n";
    if(action==="accept"){subject+="Termin bestätigt";body+="dein "+kind+" am "+date+" wurde bestätigt.\n\n";}
    else if(action==="reject"){subject+="Termin abgelehnt";body+="dein "+kind+" am "+date+" wurde abgelehnt.\n\n";}
    else {subject+="Termin nachträglich abgesagt";body+="der Termin am "+date+" wurde nachträglich abgesagt.\n\n";}
    body+="Dies ist eine Testbuchung. Es wurde kein echtes Geld verarbeitet und keine E-Mail automatisch versendet.\n\nViele Grüße\nEcoBin-Team";
    return {to:TEST_EMAIL,subject,text:body};
  }
  function normalizeLocalTestBookings(){
    const list=getLocalTestBookings(); let changed=false;
    list.forEach(b=>{if(!b._testData)return; if(b.email!==TEST_EMAIL){b.email=TEST_EMAIL;changed=true;} if(!b.date){b.date=b.cleaningDate||b.desiredDate||todayIso();changed=true;} if(b.amount==null){b.amount=Number(b.totalPrice||b.price||25);changed=true;} if(!b.bookingType){b.bookingType=b.abo?"Monatsabo":"Einzelbuchung";changed=true;} if(!b.status){b.status="pending";changed=true;}});
    if(changed)saveLocalTestBookings(list);
  }
  function createLocalTestBooking(isAbo){
    const id=(isAbo?"TEST-ABO-":"TEST-")+Date.now();
    const booking={id,_uid:id,_testData:true,name:"EcoBin Testkunde",email:TEST_EMAIL,address:"Teststraße 1, 00000 Testort",date:todayIso(),desiredDate:todayIso(),cleaningDate:todayIso(),amount:25,totalPrice:25,price:25,status:"pending",paymentStatus:"Testzahlung – kein echtes Geld",bookingType:isAbo?"Monatsabo":"Einzelbuchung",abo:!!isAbo,createdAt:new Date().toISOString(),notes:"Automatisch erzeugte Testbuchung. Keine echte PayPal-Zahlung.",paypalRef:"TEST-NO-PAYPAL"};
    saveLocalTestBooking(booking); bookings=[booking].concat(bookings||[]); render();
    addTestAction((isAbo?"Test-Abo":"Testbuchung")+" erstellt ("+id+")");
    showToast((isAbo?"Test-Abo":"Testbuchung")+" erstellt – kann jetzt wie eine normale Buchung behandelt werden.");
  }
  const testCreateBooking=document.getElementById("test-create-booking"), testCreateAbo=document.getElementById("test-create-abo");
  if(testCreateBooking)testCreateBooking.addEventListener("click",()=>createLocalTestBooking(false));
  if(testCreateAbo)testCreateAbo.addEventListener("click",()=>createLocalTestBooking(true));
  normalizeLocalTestBookings();

  // ---------- Preise & Produkte ----------
  const PR_FIELDS = {
    binBase: "pr-binBase",
    binAdditional: "pr-binAdditional",
    binGross: "pr-binGross",
    binContainer: "pr-binContainer",
    extraDuft: "pr-extraDuft",
    extraPulver: "pr-extraPulver",
    extraWasser: "pr-extraWasser",
    aboDiscountPercent: "pr-aboDiscountPercent",
  };
  let preiseLoaded = false;
  async function loadPreise() {
    const statusEl = document.getElementById("pr-status");
    const wrap = document.getElementById("pr-fields-wrap");
    if (!statusEl || !wrap) return;
    statusEl.textContent = "Lädt …";
    statusEl.style.display = "block";
    wrap.style.display = "none";
    try {
      const prices = await api("/api/admin/prices");
      if (prices && prices.error) throw new Error(prices.error);
      Object.keys(PR_FIELDS).forEach((key) => {
        const el = document.getElementById(PR_FIELDS[key]);
        if (el && prices && prices[key] != null) el.value = prices[key];
      });
      statusEl.style.display = "none";
      wrap.style.display = "grid";
      preiseLoaded = true;
    } catch (e) {
      statusEl.textContent = "Preise konnten nicht geladen werden. " + (e && e.message ? e.message : "");
    }
  }
  const prSaveBtn = document.getElementById("pr-save-btn");
  if (prSaveBtn) {
    prSaveBtn.addEventListener("click", async () => {
      const values = {};
      Object.keys(PR_FIELDS).forEach((key) => {
        const el = document.getElementById(PR_FIELDS[key]);
        values[key] = el ? Number(el.value) : undefined;
      });
      prSaveBtn.disabled = true;
      const originalLabel = prSaveBtn.textContent;
      prSaveBtn.textContent = "Speichert …";
      try {
        const updated = await api("/api/admin/prices", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        if (updated && updated.error) throw new Error(updated.error);
        Object.keys(PR_FIELDS).forEach((key) => {
          const el = document.getElementById(PR_FIELDS[key]);
          if (el && updated && updated[key] != null) el.value = updated[key];
        });
        const msg = document.getElementById("pr-save-msg");
        if (msg) {
          msg.classList.add("show");
          clearTimeout(prSaveBtn._msgTimeout);
          prSaveBtn._msgTimeout = setTimeout(() => msg.classList.remove("show"), 3000);
        }
      } catch (e) {
        alert("Speichern fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler"));
      } finally {
        prSaveBtn.disabled = false;
        prSaveBtn.textContent = originalLabel;
      }
    });
  }

  // ---------- E-Mail-Einstellungen ----------
  const ET_FIELDS = {
    booking_accepted: { subject: "et-accepted-subject", body: "et-accepted-body-input" },
    booking_rejected: { subject: "et-rejected-subject", body: "et-rejected-body-input" },
    subscription_confirmed: { subject: "et-subscription-confirmed-subject", body: "et-subscription-confirmed-body-input" },
    subscription_cancelled: { subject: "et-subscription-cancelled-subject", body: "et-subscription-cancelled-body-input" },
    subscription_paused: { subject: "et-subscription-paused-subject", body: "et-subscription-paused-body-input" },
    appointment_rescheduled: { subject: "et-appointment-rescheduled-subject", body: "et-appointment-rescheduled-body-input" },
    payment_successful: { subject: "et-payment-successful-subject", body: "et-payment-successful-body-input" },
    payment_failed: { subject: "et-payment-failed-subject", body: "et-payment-failed-body-input" },
    subscription_cancel_notice: { subject: "et-subscription-cancel-notice-subject", body: "et-subscription-cancel-notice-body-input" },
    general: { subject: "et-general-subject", body: "et-general-body-input" },
  };

  function wireEmailAccordions() {
    document.querySelectorAll("[data-et-toggle]").forEach((head) => {
      head.addEventListener("click", () => {
        const body = document.getElementById(head.dataset.etToggle);
        if (!body) return;
        const accordion = head.closest(".et-accordion");
        if (accordion) accordion.classList.toggle("open");
      });
    });
  }

  async function loadEmailVorlagen() {
    const statusEl = document.getElementById("et-status");
    const wrap = document.getElementById("et-fields-wrap");
    if (!statusEl || !wrap) return;
    statusEl.textContent = "Lädt …";
    statusEl.style.display = "block";
    wrap.style.display = "none";
    try {
      const [templates, sender] = await Promise.all([
        api("/api/admin/email-templates"),
        api("/api/admin/email-settings"),
      ]);
      if (templates && templates.error) throw new Error(templates.error);
      if (sender && sender.error) throw new Error(sender.error);

      Object.keys(ET_FIELDS).forEach((type) => {
        const tpl = (templates && templates[type]) || {};
        const subjEl = document.getElementById(ET_FIELDS[type].subject);
        const bodyEl = document.getElementById(ET_FIELDS[type].body);
        if (subjEl) subjEl.value = tpl.subject || "";
        if (bodyEl) bodyEl.value = tpl.body || "";
      });

      const senderName = document.getElementById("et-sender-name");
      const senderAddress = document.getElementById("et-sender-address");
      if (senderName) senderName.value = (sender && sender.name) || "";
      if (senderAddress) senderAddress.value = (sender && sender.address) || "";

      statusEl.style.display = "none";
      wrap.style.display = "block";
    } catch (e) {
      statusEl.textContent = "E-Mail-Einstellungen konnten nicht geladen werden. " + (e && e.message ? e.message : "");
      wrap.style.display = "none";
    }
  }

  function collectEmailTemplates() {
    const values = {};
    Object.keys(ET_FIELDS).forEach((type) => {
      const subjEl = document.getElementById(ET_FIELDS[type].subject);
      const bodyEl = document.getElementById(ET_FIELDS[type].body);
      values[type] = {
        subject: subjEl ? subjEl.value : "",
        body: bodyEl ? bodyEl.value : "",
      };
    });
    return values;
  }

  async function saveEmailTemplates(btn) {
    const values = collectEmailTemplates();
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Speichert …";
    try {
      const updated = await api("/api/admin/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (updated && updated.error) throw new Error(updated.error);
      Object.keys(ET_FIELDS).forEach((type) => {
        const tpl = (updated && updated[type]) || {};
        const subjEl = document.getElementById(ET_FIELDS[type].subject);
        const bodyEl = document.getElementById(ET_FIELDS[type].body);
        if (subjEl) subjEl.value = tpl.subject || "";
        if (bodyEl) bodyEl.value = tpl.body || "";
      });
      const msg = btn.parentElement.querySelector(".et-template-save-msg");
      if (msg) {
        msg.classList.add("show");
        clearTimeout(btn._msgTimeout);
        btn._msgTimeout = setTimeout(() => msg.classList.remove("show"), 3000);
      }
    } catch (e) {
      alert("Speichern fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler"));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  async function saveEmailSender() {
    const btn = document.getElementById("et-sender-save-btn");
    if (!btn) return;
    const name = (document.getElementById("et-sender-name")?.value || "").trim();
    const address = (document.getElementById("et-sender-address")?.value || "").trim();
    if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      alert("Bitte eine gültige Absenderadresse eingeben.");
      return;
    }
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Speichert …";
    try {
      const saved = await api("/api/admin/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address }),
      });
      if (saved && saved.error) throw new Error(saved.error);
      const msg = document.getElementById("et-sender-save-msg");
      if (msg) {
        msg.classList.add("show");
        clearTimeout(btn._msgTimeout);
        btn._msgTimeout = setTimeout(() => msg.classList.remove("show"), 3000);
      }
    } catch (e) {
      alert("Speichern fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler"));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  wireEmailAccordions();
  document.querySelectorAll(".et-template-save").forEach((btn) => {
    btn.addEventListener("click", () => saveEmailTemplates(btn));
  });
  document.getElementById("et-sender-save-btn")?.addEventListener("click", saveEmailSender);

  function statusInfo(b, todayI) {
    if (b.status === "cancelled") return { label: "Abgesagt", cls: "pill-rej" };
    if (b.status === "rejected") return { label: "Storniert", cls: "pill-rej" };
    if (b.status === "pending") return { label: "Neu", cls: "pill-new" };
    if (b.status === "paused") return { label: "Pausiert", cls: "pill-pause" };
    if (b.status === "accepted") {
      if (b.date && b.date < todayI) return { label: "Erledigt", cls: "pill-done" };
      return { label: "Bestätigt", cls: "pill-ok" };
    }
    return { label: b.status || "–", cls: "pill-done" };
  }

  function bookingRowHtml(b, todayI) {
    const st = statusInfo(b, todayI);
    const bins = b.binTypes || (b.bins != null ? b.bins + "× Tonne" : "–");
    return (
      "<tr>" +
      '<td class="cust"><b>' + escapeHtml(b.name || "Unbekannt") + "</b></td>" +
      "<td>" + formatDateDe(b.date) + "</td>" +
      "<td>" + escapeHtml(bins) + "</td>" +
      '<td class="price">' + formatEuro(b.amount) + "</td>" +
      '<td><span class="pill ' + st.cls + '">' + st.label + "</span></td>" +
      '<td><span class="pill pill-paid">Bezahlt</span></td>' +
      "</tr>"
    );
  }

  function renderTable(containerId, list, todayI, emptyText) {
    const el = document.getElementById(containerId);
    if (!list.length) { el.innerHTML = '<div class="empty-state">' + emptyText + "</div>"; return; }
    el.innerHTML =
      '<table class="tbl"><thead><tr>' +
      "<th>Kunde</th><th>Termin</th><th>Tonnen</th><th>Betrag</th><th>Status</th><th>Zahlung</th>" +
      "</tr></thead><tbody>" + list.map((b) => bookingRowHtml(b, todayI)).join("") + "</tbody></table>";
  }

  let calView = "month";
  let calDate = new Date();
  calDate.setHours(0, 0, 0, 0);

  function isoDateOf(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDaysCal(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    r.setHours(0, 0, 0, 0);
    return r;
  }
  function startOfWeekCal(d) {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDaysCal(d, diff);
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function buildMonthDays(refDate) {
    const year = refDate.getFullYear(), month = refDate.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const start = startOfWeekCal(first);
    const totalDays = Math.round((last - start) / 86400000) + 1;
    const totalCells = Math.ceil(totalDays / 7) * 7;
    const days = [];
    for (let i = 0; i < totalCells; i++) days.push(addDaysCal(start, i));
    return days;
  }
  function buildWeekDays(refDate) {
    const start = startOfWeekCal(refDate);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDaysCal(start, i));
    return days;
  }

  function calTitleText() {
    if (calView === "month") {
      return capitalize(calDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" }));
    }
    const days = buildWeekDays(calDate);
    const start = days[0], end = days[6];
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return start.getDate() + ".–" + end.getDate() + ". " + capitalize(end.toLocaleDateString("de-DE", { month: "long", year: "numeric" }));
    }
    const mStart = start.toLocaleDateString("de-DE", { month: "short" });
    const mEnd = end.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
    return start.getDate() + ". " + mStart + " – " + end.getDate() + ". " + mEnd;
  }

  function calEventHtml(b, todayI) {
    const st = statusInfo(b, todayI);
    const isTest = isLocalTestBooking(b);
    const dotColor = isTest ? "#d97706" : ({ "pill-new": "#1b5fa8", "pill-ok": "var(--green-dark)", "pill-done": "var(--muted)", "pill-rej": "var(--danger)" }[st.cls] || "var(--muted)");
    const testLabel = isTest ? '<span class="cal-test-label">' + (b.abo ? 'TEST-ABO' : 'TEST') + '</span>' : '';
    const eventClass = isTest ? 'cal-event test-event' : 'cal-event';
    return (
      '<div class="' + eventClass + '" data-uid="' + escapeHtml(String(b._uid != null ? b._uid : (b.id != null ? b.id : ""))) + '">' +
      '<div class="cal-event-top"><span class="cal-dot" style="background:' + dotColor + '"></span><span class="cal-name">' + escapeHtml(b.name || "Unbekannt") + testLabel + "</span></div>" +
      '<div class="cal-event-bottom"><span class="cal-price">' + formatEuro(b.amount) + '</span><span class="cal-status" style="color:' + dotColor + '">' + (isTest ? 'Testbuchung' : st.label) + "</span></div>" +
      "</div>"
    );
  }

  function renderCalendar() {
    const titleEl = document.getElementById("cal-title");
    const gridEl = document.getElementById("cal-grid");
    if (!titleEl || !gridEl) return;

    titleEl.textContent = calTitleText();
    document.querySelectorAll(".cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.calView === calView));

    const todayI = todayIso();
    const byDate = {};
    bookings.filter((b) => b.date && b.status !== "rejected").forEach((b) => {
      (byDate[b.date] = byDate[b.date] || []).push(b);
    });

    const days = calView === "month" ? buildMonthDays(calDate) : buildWeekDays(calDate);
    const currentMonth = calDate.getMonth();
    const dayHeadNames = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];

    let html = dayHeadNames.map((n) => '<div class="cal-dayhead">' + n + "</div>").join("");
    html += days.map((day) => {
      const iso = isoDateOf(day);
      const evts = (byDate[iso] || []).slice().sort((a, c) => (a.name || "").localeCompare(c.name || ""));
      const isToday = iso === todayI;
      const inMonth = calView === "week" ? true : day.getMonth() === currentMonth;
      let cls = "cal-cell";
      if (evts.length) cls += " has-events";
      if (isToday) cls += " today";
      if (!inMonth) cls += " out-month";
      return (
        '<div class="' + cls + '">' +
        '<div class="cal-daynum">' + day.getDate() + "</div>" +
        evts.map((b) => calEventHtml(b, todayI)).join("") +
        "</div>"
      );
    }).join("");

    gridEl.innerHTML = html;
    gridEl.querySelectorAll(".cal-event[data-uid]").forEach((el) => {
      el.addEventListener("click", () => openBookingDetail(el.dataset.uid));
    });
  }

  document.getElementById("cal-prev").addEventListener("click", () => {
    calDate = calView === "month" ? new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1) : addDaysCal(calDate, -7);
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", () => {
    calDate = calView === "month" ? new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1) : addDaysCal(calDate, 7);
    renderCalendar();
  });
  document.getElementById("cal-today").addEventListener("click", () => {
    calDate = new Date();
    calDate.setHours(0, 0, 0, 0);
    renderCalendar();
  });
  document.querySelectorAll(".cal-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      calView = btn.dataset.calView;
      renderCalendar();
    });
  });

  function aboStatusInfo(b) {
    if (b.status === "rejected") return { label: "Gekündigt", cls: "pill-rej" };
    if (b.status === "pending") return { label: "Neu", cls: "pill-new" };
    if (b.status === "paused") return { label: "Pausiert", cls: "pill-pause" };
    if (b.status === "accepted") return { label: "Aktiv", cls: "pill-ok" };
    return { label: b.status || "–", cls: "pill-done" };
  }

  function aboRowHtml(b) {
    const st = aboStatusInfo(b);
    return (
      '<tr class="row-click" data-uid="' + b._uid + '">' +
      '<td class="cust"><b>' + escapeHtml(b.name || "Unbekannt") + "</b></td>" +
      "<td>" + formatDateDe(b.createdAt ? String(b.createdAt).slice(0, 10) : null) + "</td>" +
      "<td>" + formatDateDe(b.date) + "</td>" +
      '<td class="price">' + formatEuro(b.amount) + " / Monat</td>" +
      '<td><span class="pill ' + st.cls + '">' + st.label + "</span></td>" +
      "</tr>"
    );
  }

  function renderAboTable(list) {
    const el = document.getElementById("abo-table");
    if (!list.length) { el.innerHTML = '<div class="empty-state">Keine Abonnements in dieser Ansicht.</div>'; return; }
    el.innerHTML =
      '<table class="tbl"><thead><tr>' +
      "<th>Kunde</th><th>Seit</th><th>Nächster Termin</th><th>Betrag</th><th>Status</th>" +
      "</tr></thead><tbody>" + list.map(aboRowHtml).join("") + "</tbody></table>";
    el.querySelectorAll("tr[data-uid]").forEach((tr) => {
      tr.addEventListener("click", () => showKundeDetail(tr.dataset.uid));
    });
  }

  let aboFilter = "active";

  function aboFilteredList(list) {
    if (aboFilter === "active") return list.filter((b) => b.status === "accepted");
    if (aboFilter === "pending") return list.filter((b) => b.status === "pending");
    if (aboFilter === "paused") return list.filter((b) => b.status === "paused");
    if (aboFilter === "rejected") return list.filter((b) => b.status === "rejected");
    return list;
  }

  function renderAbos() {
    const totalEl = document.getElementById("abo-stat-active");
    if (!totalEl) return;

    const all = bookings.filter((b) => b.abo);
    const active = all.filter((b) => b.status === "accepted");
    const pending = all.filter((b) => b.status === "pending");
    const paused = all.filter((b) => b.status === "paused");
    const rejected = all.filter((b) => b.status === "rejected");

    document.getElementById("abo-stat-active").textContent = active.length;
    document.getElementById("abo-stat-pending").textContent = pending.length;
    document.getElementById("abo-stat-total").textContent = all.length;
    document.getElementById("abo-stat-total-sub").textContent = all.length ? "seit Start" : "noch keine Abos";
    const revenue = active.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    document.getElementById("abo-stat-revenue").textContent = formatEuro(revenue);

    const counts = { active: active.length, pending: pending.length, paused: paused.length, rejected: rejected.length, all: all.length };
    Object.keys(counts).forEach((k) => {
      const cntEl = document.getElementById("abo-cnt-" + k);
      if (cntEl) cntEl.textContent = counts[k];
    });
    document.querySelectorAll("#abo-tabs .pf-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.aboFilter === aboFilter));

    const filtered = aboFilteredList(all).slice().sort((a, c) => (c.createdAt || "").localeCompare(a.createdAt || ""));
    renderAboTable(filtered);
  }

  document.querySelectorAll("#abo-tabs .pf-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      aboFilter = btn.dataset.aboFilter;
      renderAbos();
    });
  });

  let pfFilter = "open";

  function mailCardHtml(b, todayI) {
    const st = statusInfo(b, todayI);
    const buchungsart = b.abo ? "Monatsabo" : "Einmalzahlung";
    return (
      '<div class="mail-card" data-uid="' + escapeHtml(String(b._uid != null ? b._uid : (b.id != null ? b.id : ""))) + '">' +
      "<h4>" + escapeHtml(b.name || "Unbekannt") + "</h4>" +
      '<div class="mail-row"><span class="k">Reinigungstermin</span><span class="v">' + formatDateDe(b.date) + "</span></div>" +
      '<div class="mail-row"><span class="k">Gesamtpreis</span><span class="v price">' + formatEuro(b.amount) + "</span></div>" +
      '<div class="mail-row"><span class="k">Buchungsart</span><span class="v">' + buchungsart + "</span></div>" +
      '<div class="mail-row"><span class="k">Buchungsdatum</span><span class="v">' + formatDateDe(b.createdAt ? String(b.createdAt).slice(0, 10) : null) + "</span></div>" +
      '<div class="mail-row"><span class="k">Status</span><span class="pill ' + st.cls + '">' + st.label + "</span></div>" +
      "</div>"
    );
  }

  function renderCards(containerId, list, todayI, emptyText) {
    const el = document.getElementById(containerId);
    if (!list.length) { el.innerHTML = '<div class="empty-state">' + emptyText + "</div>"; return; }
    el.innerHTML = list.map((b) => mailCardHtml(b, todayI)).join("");
    el.querySelectorAll(".mail-card").forEach((card) => {
      card.addEventListener("click", () => openBookingDetail(card.dataset.uid));
    });
  }

  // Vorschau der offenen Postfach-Einträge fürs Dashboard (kein Verlauf, keine erledigten Buchungen)
  function renderNotifications(list, todayI) {
    const pendingAll = list
      .filter((b) => b.status === "pending")
      .slice()
      .sort((a, c) => (c.createdAt || "").localeCompare(a.createdAt || ""));

    const pendingCount = pendingAll.length;
    const badge = document.getElementById("dashboard-open-badge");
    const panel = document.getElementById("dashboard-notifications-panel");

    if (badge) {
      badge.textContent = pendingCount;
      badge.style.display = pendingCount > 0 ? "inline-flex" : "none";
    }
    if (panel) {
      panel.classList.toggle("alert", pendingCount > 0);
    }

    // Im Dashboard weiterhin nur die neuesten 3 offenen Anfragen anzeigen.
    renderCards("notifications", pendingAll.slice(0, 3), todayI, "Keine offenen Anfragen im Postfach.");
  }

  function pfFilteredList(list) {
    if (pfFilter === "open") return list.filter((b) => b.status === "pending");
    if (pfFilter === "accepted") return list.filter((b) => b.status === "accepted");
    if (pfFilter === "rejected") return list.filter((b) => b.status === "rejected");
    return list;
  }

  function renderPostfach(list, todayI) {
    // Offene Aufträge – hauptbereich, immer nur unbeantwortete Buchungen
    const open = list
      .filter((b) => b.status === "pending")
      .slice()
      .sort((a, c) => (c.createdAt || "").localeCompare(a.createdAt || ""));
    renderCards("postfach-open", open, todayI, "Keine offenen Aufträge.");

    // Zähler für die Filter-Tabs
    const counts = {
      open: open.length,
      accepted: list.filter((b) => b.status === "accepted").length,
      rejected: list.filter((b) => b.status === "rejected").length,
      all: list.length,
    };
    Object.keys(counts).forEach((k) => {
      const cntEl = document.getElementById("pf-cnt-" + k);
      if (cntEl) cntEl.textContent = counts[k];
    });
    document.querySelectorAll("#pf-tabs .pf-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.pfFilter === pfFilter));

    // Sidebar-Badge
    const badge = document.getElementById("pf-badge");
    if (badge) {
      badge.textContent = counts.open;
      badge.style.display = counts.open > 0 ? "inline-block" : "none";
    }

    // Verlauf – gefiltert nach ausgewähltem Tab, nur rendern wenn eingeblendet
    if (pfHistoryOpen) {
      const history = pfFilteredList(list)
        .slice()
        .sort((a, c) => (c.createdAt || "").localeCompare(a.createdAt || ""));
      renderCards("postfach-history", history, todayI, "Keine Buchungen in dieser Ansicht.");
    }
  }

  document.querySelectorAll("#pf-tabs .pf-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      pfFilter = btn.dataset.pfFilter;
      renderPostfach(bookings, todayIso());
    });
  });

  let pfHistoryOpen = false;
  const pfHistoryToggle = document.getElementById("pf-history-toggle");
  const pfHistoryBody = document.getElementById("pf-history-body");
  pfHistoryToggle.addEventListener("click", () => {
    pfHistoryOpen = !pfHistoryOpen;
    pfHistoryBody.style.display = pfHistoryOpen ? "block" : "none";
    pfHistoryToggle.textContent = pfHistoryOpen ? "Verlauf ausblenden" : "Verlauf anzeigen";
    if (pfHistoryOpen) renderPostfach(bookings, todayIso());
  });

  document.querySelectorAll("#postfach-subtabs .pf-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#postfach-subtabs .pf-tab").forEach((b) => b.classList.toggle("active", b === btn));
      const sub = btn.dataset.pfSub;
      document.getElementById("pf-sub-buchungen").style.display = sub === "buchungen" ? "block" : "none";
      document.getElementById("pf-sub-andere").style.display = sub === "andere" ? "block" : "none";
    });
  });

  const TEST_BOOKINGS_KEY = "ecobin_test_bookings";
  const TEST_EMAIL = "mikaback777@gmail.com";
  function getLocalTestBookings() { try { const raw=JSON.parse(localStorage.getItem(TEST_BOOKINGS_KEY)||"[]"); return Array.isArray(raw)?raw:[]; } catch(_) { return []; } }
  function saveLocalTestBookings(list) { localStorage.setItem(TEST_BOOKINGS_KEY, JSON.stringify((Array.isArray(list)?list:[]).slice(0,50))); }
  function saveLocalTestBooking(booking) { const list=getLocalTestBookings(); const idx=list.findIndex(x=>String(x._uid||x.id)===String(booking._uid||booking.id)); if(idx>=0) list[idx]=booking; else list.unshift(booking); saveLocalTestBookings(list); }
  function updateLocalTestBooking(booking) { saveLocalTestBooking(booking); }
  function isLocalTestBooking(b) { return !!(b && b._testData===true); }

  let otherMessagesLoaded = false;

  async function loadDashboard() {
    const btn = document.getElementById("refresh-btn");
    btn.disabled = true; btn.textContent = "Lädt …";
    otherMessagesLoaded = false; // beim expliziten Neuladen auch Gmail-Nachrichten aktualisieren
    try {
      bookings = await api("/api/admin/bookings?status=all");
      if (!Array.isArray(bookings)) bookings = [];
      bookings.forEach((b, i) => { b._uid = b.id != null ? String(b.id) : String(i); });
      const localTests = getLocalTestBookings();
      bookings = localTests.concat(bookings);
      render();
    } catch (e) {
      // 401 already handled inside api(); other errors:
      if (token) {
        document.getElementById("next-appointments").innerHTML = '<div class="empty-state">Fehler beim Laden der Daten.</div>';
        document.getElementById("notifications").innerHTML = '<div class="empty-state">Fehler beim Laden der Daten.</div>';
        document.getElementById("recent-bookings").innerHTML = '<div class="empty-state">Fehler beim Laden der Daten.</div>';
        document.getElementById("postfach-open").innerHTML = '<div class="empty-state">Fehler beim Laden der Daten.</div>';
        document.getElementById("postfach-history").innerHTML = '<div class="empty-state">Fehler beim Laden der Daten.</div>';
        document.getElementById("abo-table").innerHTML = '<div class="empty-state">Fehler beim Laden der Daten.</div>';
      }
    } finally {
      btn.disabled = false; btn.textContent = "🔄 Aktualisieren";
    }
  }

  function render() {
    const todayI = todayIso();
    const now = new Date();
    const curMonth = now.getMonth(), curYear = now.getFullYear();
    const monthName = now.toLocaleDateString("de-DE", { month: "long" });
    document.getElementById("stat-revenue-label").textContent = "Umsatz (" + monthName + ")";

    // Offene Buchungen
    const pending = bookings.filter((b) => b.status === "pending");
    const pendingCount = pending.length;
    const pendingCard = document.getElementById("stat-pending")?.closest(".stat-card");
    if (pendingCard) pendingCard.classList.toggle("dashboard-alert", pendingCount > 0);
    document.getElementById("stat-pending").textContent = pendingCount;

    // Aktive Monatsabos
    const aboAll = bookings.filter((b) => b.abo);
    const aboActive = aboAll.filter((b) => b.status === "accepted");
    document.getElementById("stat-abos").textContent = aboActive.length;
    document.getElementById("stat-abos-sub").textContent = "von " + aboAll.length + " insgesamt";

    // Umsatz aktueller Monat (bestätigte Buchungen mit Termin in diesem Monat)
    const revenue = bookings
      .filter((b) => b.status === "accepted" && b.date)
      .filter((b) => {
        const d = new Date(b.date + "T00:00:00");
        return d.getMonth() === curMonth && d.getFullYear() === curYear;
      })
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    document.getElementById("stat-revenue").textContent = formatEuro(revenue);

    // Kunden gesamt (eindeutige E-Mail/Name)
    const customerKeys = new Set(bookings.map((b) => (b.email || b.name || "").toLowerCase()).filter(Boolean));
    document.getElementById("stat-customers").textContent = customerKeys.size;

    // Nächste Termine
    const upcoming = bookings
      .filter((b) => b.status !== "rejected" && b.status !== "cancelled" && b.date && b.date >= todayI)
      .sort((a, c) => a.date.localeCompare(c.date))
      .slice(0, 6);
    renderTable("next-appointments", upcoming, todayI, "Keine bevorstehenden Termine.");

    // Letzte Buchungen
    const recent = bookings
      .slice()
      .sort((a, c) => (c.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 8);
    renderTable("recent-bookings", recent, todayI, "Noch keine Buchungen vorhanden.");

    // Aktuelle Benachrichtigungen (Dashboard) = Vorschau der offenen Postfach-Einträge
    renderNotifications(bookings, todayI);

    // Kalender (Monats-/Wochenansicht mit Live-Daten)
    renderCalendar();

    // Monatsabos
    renderAbos();

    // Postfach (offene Aufträge + filterbarer Verlauf)
    renderPostfach(bookings, todayI);

    // Andere Nachrichten (Postfach) – echte Gmail-Nachrichten laden
    if (!otherMessagesLoaded) {
      otherMessagesLoaded = true;
      loadOtherMessages();
    } else {
      renderOtherMessages();
    }

    // Kunden
    renderKundenTable();
  }

  // ---------- Kundendetail (Monatsabos) ----------
  let currentKundeUid = null;

  function findBookingByUid(uid) {
    return bookings.find((b) => b._uid === String(uid));
  }

  function fieldVal(b, keys, fallback) {
    for (const k of keys) {
      const v = b[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return fallback !== undefined ? fallback : "–";
  }

  function formatBinsDetail(b) {
    if (Array.isArray(b.binsDetail) && b.binsDetail.length) {
      return escapeHtml(b.binsDetail.map((x) => (x.amount || x.qty || "") + "× " + (x.type || x.name || "")).join(", "));
    }
    if (b.binTypes) return escapeHtml(String(b.binTypes));
    if (b.bins != null) return escapeHtml(b.bins + "× Tonne");
    return "–";
  }

  function formatExtras(b) {
    if (Array.isArray(b.extras) && b.extras.length) return escapeHtml(b.extras.join(", "));
    if (typeof b.extras === "string" && b.extras) return escapeHtml(b.extras);
    return "–";
  }

  function formatAddress(b) {
    const strasse = fieldVal(b, ["address", "strasse", "street"], "");
    const plz = fieldVal(b, ["plz", "zip", "postcode"], "");
    const ort = fieldVal(b, ["ort", "city"], "");
    const zeile2 = [plz, ort].filter((x) => x && x !== "–").join(" ");
    const parts = [strasse, zeile2].filter((x) => x && x !== "–");
    return parts.length ? escapeHtml(parts.join(", ")) : "–";
  }

  function kdRowHtml(k, v) {
    return '<div class="mail-row"><span class="k">' + k + '</span><span class="v">' + v + "</span></div>";
  }

  function renderKundeDetail(b) {
    const st = aboStatusInfo(b);
    document.getElementById("kd-title").textContent = b.name || "Unbekannt";
    document.getElementById("kd-status").innerHTML = '<span class="pill ' + st.cls + '">' + st.label + "</span>";
    document.getElementById("kd-fields").innerHTML =
      kdRowHtml("Name", escapeHtml(b.name || "Unbekannt")) +
      kdRowHtml("E-Mail", escapeHtml(fieldVal(b, ["email"]))) +
      kdRowHtml("Telefon", escapeHtml(fieldVal(b, ["phone", "telefon", "tel"]))) +
      kdRowHtml("Adresse", formatAddress(b)) +
      kdRowHtml("Tonnenarten &amp; Mengen", formatBinsDetail(b)) +
      kdRowHtml("Extras", formatExtras(b)) +
      kdRowHtml("Reinigungstermin", formatDateDe(b.date)) +
      kdRowHtml("Buchungsdatum", formatDateDe(b.createdAt ? String(b.createdAt).slice(0, 10) : null)) +
      kdRowHtml("Buchungsart", b.abo ? "Monatsabo" : "Einmalzahlung") +
      kdRowHtml("Betrag", formatEuro(b.amount) + (b.abo ? " / Monat" : "")) +
      kdRowHtml("Notizen", escapeHtml(fieldVal(b, ["notes", "message", "wunsch", "comment"])));

    document.getElementById("kd-edit-panel").style.display = "none";
    document.getElementById("kd-edit-toggle").textContent = "✎ Bearbeiten";
    document.getElementById("kd-custom-mail").style.display = "none";
  }

  function showKundeDetail(uid) {
    const b = findBookingByUid(uid);
    if (!b) return;
    currentKundeUid = String(uid);
    document.querySelectorAll(".content").forEach((el) => { el.style.display = "none"; });
    document.getElementById("view-kunde-detail").style.display = "block";
    document.querySelectorAll(".sb-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === "abos"));
    document.getElementById("page-title").textContent = "Kunde";
    document.getElementById("page-sub").textContent = "Details zum Monatsabo";
    renderKundeDetail(b);
  }

  document.getElementById("kd-back").addEventListener("click", () => switchTab("abos"));

  document.getElementById("kd-edit-toggle").addEventListener("click", () => {
    const panel = document.getElementById("kd-edit-panel");
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    document.getElementById("kd-edit-toggle").textContent = open ? "✎ Bearbeiten" : "Schließen";
    if (open) document.getElementById("kd-custom-mail").style.display = "none";
  });

  function openMailDraft(to, subject, body) {
    window.location.href = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  function setBookingStatus(uid, status) {
    const b = findBookingByUid(uid);
    if (!b) return;
    b.status = status;
    render();
    renderKundeDetail(b);
  }

  // ---------- Buchungsdetailansicht (Postfach → Buchungsanfragen) ----------
  let currentBookingDetailUid = null;

  function bdFieldsHtml(b) {
    const buchungsart = b.abo ? "Monatsabo" : "Einmalzahlung";
    const rows = [
      ["Name", escapeHtml(fieldVal(b, ["name"], "–"))],
      ["E-Mail", escapeHtml(fieldVal(b, ["email"], "–"))],
      ["Adresse", formatAddress(b)],
      ["Reinigungstermin", formatDateDe(b.date)],
      ["Buchungsdatum", formatDateDe(b.createdAt ? String(b.createdAt).slice(0, 10) : null)],
      ["Buchungsart", buchungsart],
      ["Gesamtpreis", formatEuro(b.amount)],
      ["Zahlungsstatus", "Bezahlt"],
      ["PayPal-Referenz", escapeHtml(fieldVal(b, ["paypalRef"], "–"))],
      ["Tonnen", b.binTypes ? escapeHtml(String(b.binTypes)) : "–"],
      ["Anzahl der Tonnen", b.bins != null ? escapeHtml(String(b.bins)) : "–"],
      ["Extras", formatExtras(b)],
      ["Zusätzliche Informationen", escapeHtml(fieldVal(b, ["note"], "–"))],
    ];
    return rows.map(([k, v]) => kdRowHtml(k, v)).join("");
  }

  function openBookingDetail(uid) {
    const b = findBookingByUid(uid);
    if (!b) return;
    currentBookingDetailUid = String(uid);

    document.getElementById("bd-title").textContent = b.name || "Buchung";
    const st = statusInfo(b, todayIso());
    const statusEl = document.getElementById("bd-status");
    statusEl.className = "pill " + st.cls;
    statusEl.textContent = st.label;
    document.getElementById("bd-fields").innerHTML = bdFieldsHtml(b);

    const msg = document.getElementById("bd-action-msg");
    msg.className = "bd-action-msg";
    msg.textContent = "";

    const actions = document.getElementById("bd-actions");
    const refundHint = document.getElementById("bd-refund-hint");
    const cancelBtn = document.getElementById("bd-cancel-btn");
    const cancelNote = document.getElementById("bd-cancel-note");
    const isPending = b.status === "pending";
    const isAccepted = b.status === "accepted";
    resetCancelConfirmState();
    actions.style.display = isPending ? "flex" : "none";
    refundHint.style.display = isPending ? "block" : "none";
    cancelBtn.style.display = isAccepted ? "block" : "none";
    cancelNote.style.display = isAccepted ? "block" : "none";
    document.getElementById("bd-accept-btn").disabled = false;
    document.getElementById("bd-reject-btn").disabled = false;

    document.getElementById("booking-detail-modal").style.display = "flex";
  }

  function closeBookingDetail() {
    document.getElementById("booking-detail-modal").style.display = "none";
    currentBookingDetailUid = null;
  }

  document.getElementById("bd-close-btn").addEventListener("click", closeBookingDetail);
  document.getElementById("booking-detail-modal").addEventListener("click", (e) => {
    if (e.target.id === "booking-detail-modal") closeBookingDetail();
  });

  // Schritt 3: Termin nachträglich absagen.
  const cancelConfirmModal = document.getElementById("bd-cancel-confirm-modal");
  const cancelConfirmYes = document.getElementById("bd-cancel-confirm-yes");
  const cancelConfirmNo = document.getElementById("bd-cancel-confirm-no");
  let cancelInProgress = false;

  function resetCancelConfirmState() {
    cancelInProgress = false;
    cancelConfirmYes.disabled = false;
    cancelConfirmNo.disabled = false;
    cancelConfirmModal.style.display = "none";
  }

  document.getElementById("bd-cancel-btn").addEventListener("click", () => {
    const uid = currentBookingDetailUid;
    const b = findBookingByUid(uid);
    if (!uid || !b || b.status !== "accepted" || cancelInProgress) return;

    document.getElementById("bd-cancel-confirm-text").textContent =
      "Möchtest du den Termin am " + formatDateDe(b.date) + " für " + (b.name || "diesen Kunden") + " wirklich nachträglich absagen?";

    // Jeder neue Absagevorgang startet mit einem frischen, aktivierten Dialog.
    cancelConfirmYes.disabled = false;
    cancelConfirmNo.disabled = false;
    cancelInProgress = false;
    cancelConfirmModal.style.display = "flex";
  });

  cancelConfirmNo.addEventListener("click", resetCancelConfirmState);

  cancelConfirmModal.addEventListener("click", (e) => {
    if (e.target.id === "bd-cancel-confirm-modal" && !cancelInProgress) {
      resetCancelConfirmState();
    }
  });

  cancelConfirmYes.addEventListener("click", async () => {
    // UID sofort lokal sichern. Danach wird ausschließlich mit diesem
    // Vorgang gearbeitet; ein späterer Zustand von currentBookingDetailUid
    // kann diesen Vorgang nicht mehr beeinflussen.
    const uid = currentBookingDetailUid;
    const b = findBookingByUid(uid);

    if (!uid || !b || b.status !== "accepted" || cancelInProgress) {
      resetCancelConfirmState();
      return;
    }

    cancelInProgress = true;
    cancelConfirmYes.disabled = true;
    cancelConfirmNo.disabled = true;

    const msg = document.getElementById("bd-action-msg");
    msg.className = "bd-action-msg";
    msg.textContent = "Termin wird abgesagt …";

    try {
      let res = null;
      if (isLocalTestBooking(b)) {
        b.status="cancelled"; b.cancelledAt=new Date().toISOString(); updateLocalTestBooking(b);
        res={status:"cancelled",email:buildTestEmail(b,"cancel")};
        addTestAction("Testbuchung nachträglich abgesagt ("+(b.id||uid)+")");
      } else {
        const idForApi=b.id!=null?b.id:uid;
        res=await api("/api/admin/bookings/"+encodeURIComponent(idForApi)+"/cancel",{method:"POST"});
        if(!res||res.error||res.status!=="cancelled") throw new Error((res&&res.error)||"Die Absage konnte nicht bestätigt werden.");
        b.status="cancelled"; b.cancelledAt=(res.booking&&res.booking.cancelledAt)||new Date().toISOString();
      }

      // Dialog und Detailansicht vollständig schließen/zurücksetzen, bevor
      // neu gerendert wird. Damit ist der nächste Termin unabhängig.
      cancelConfirmModal.style.display = "none";
      currentBookingDetailUid = null;
      document.getElementById("booking-detail-modal").style.display = "none";

      // Alle Absage-Controls für den nächsten Vorgang explizit zurücksetzen.
      cancelConfirmYes.disabled = false;
      cancelConfirmNo.disabled = false;
      cancelInProgress = false;

      // Kalender/Dashboard neu rendern; cancelled wird dort nicht mehr aktiv
      // angezeigt. Der Datensatz bleibt in bookings/KV erhalten.
      render();
    } catch (e) {
      // Bei API-/Netzwerkfehlern bleibt die Buchung lokal unverändert.
      // Der Dialog bleibt sichtbar und kann erneut versucht werden.
      cancelConfirmYes.disabled = false;
      cancelConfirmNo.disabled = false;
      cancelInProgress = false;
      msg.className = "bd-action-msg error";
      msg.textContent = e && e.message ? e.message : "Absage fehlgeschlagen.";
    }
  });

  async function decideBookingDetail(action) {
    const uid = currentBookingDetailUid;
    const b = findBookingByUid(uid);
    if (!b) return;
    const acceptBtn = document.getElementById("bd-accept-btn");
    const rejectBtn = document.getElementById("bd-reject-btn");
    acceptBtn.disabled = true; rejectBtn.disabled = true;
    const msg = document.getElementById("bd-action-msg");
    msg.className = "bd-action-msg";
    msg.textContent = "Wird verarbeitet …";

    try {
      let res;
      if (isLocalTestBooking(b)) {
        b.status=action==="accept"?"accepted":"rejected"; b.decidedAt=new Date().toISOString(); updateLocalTestBooking(b);
        res={email:null};
        addTestAction("Testbuchung "+(action==="accept"?"angenommen":"abgelehnt")+" ("+(b.id||uid)+")");
      } else {
        const idForApi=b.id!=null?b.id:uid;
        res=await api("/api/admin/bookings/"+encodeURIComponent(idForApi)+"/"+action,{method:"POST"});
        if(res&&res.error){
          msg.className="bd-action-msg error";
          msg.textContent=res.error;
          acceptBtn.disabled=false; rejectBtn.disabled=false;
          return;
        }
        b.status=action==="accept"?"accepted":"rejected";
      }

      msg.className = "bd-action-msg ok";
      if (isLocalTestBooking(b)) {
        msg.textContent = action === "accept"
          ? "Testbuchung angenommen – keine echte E-Mail wurde verschickt."
          : "Testbuchung abgelehnt – keine echte E-Mail wurde verschickt.";
      } else if (res && res.email && res.email.to) {
        if (res.email.sent) {
          msg.textContent = action === "accept"
            ? "Buchung angenommen – die Kunden-E-Mail wurde automatisch verschickt."
            : "Buchung abgelehnt – die Kunden-E-Mail wurde automatisch verschickt.";
        } else {
          msg.className = "bd-action-msg error";
          msg.textContent = action === "accept"
            ? "Buchung angenommen, aber die Kunden-E-Mail konnte nicht verschickt werden."
            : "Buchung abgelehnt, aber die Kunden-E-Mail konnte nicht verschickt werden.";
        }
      } else {
        msg.textContent = action === "accept"
          ? "Buchung angenommen (keine E-Mail-Adresse hinterlegt)."
          : "Buchung abgelehnt (keine E-Mail-Adresse hinterlegt).";
      }
      render();
      setTimeout(closeBookingDetail, 1200);
    } catch (e) {
      msg.className = "bd-action-msg error";
      msg.textContent = e && e.message ? e.message : "Fehler – bitte erneut versuchen.";
      acceptBtn.disabled = false; rejectBtn.disabled = false;
    }
  }

  document.getElementById("bd-accept-btn").addEventListener("click", () => decideBookingDetail("accept"));
  document.getElementById("bd-reject-btn").addEventListener("click", () => decideBookingDetail("reject"));

  document.querySelectorAll(".kd-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = findBookingByUid(currentKundeUid);
      if (!b) return;
      const to = fieldVal(b, ["email"], "");
      const name = b.name || "Kunde";
      const action = btn.dataset.kdAction;

      if (action === "custom") {
        document.getElementById("kd-custom-mail").style.display = "block";
        document.getElementById("kd-custom-subject").value = "";
        document.getElementById("kd-custom-body").value = "Hallo " + name + ",\n\n\n\nViele Grüße\nIhr EcoBin-Team";
        return;
      }
      document.getElementById("kd-custom-mail").style.display = "none";

      if (action === "cancel") {
        openMailDraft(to, "Kündigung Ihres Monatsabos bei EcoBin",
          "Hallo " + name + ",\n\nhiermit bestätigen wir die Kündigung Ihres Monatsabos zur Mülltonnenreinigung.\n\nViele Grüße\nIhr EcoBin-Team");
        setBookingStatus(currentKundeUid, "rejected");
      } else if (action === "reschedule") {
        openMailDraft(to, "Terminverlegung – Ihre Mülltonnenreinigung",
          "Hallo " + name + ",\n\nwir möchten Ihren Reinigungstermin verlegen. Bitte teilen Sie uns Ihren Wunschtermin mit, oder wir schlagen Ihnen gerne einen neuen Termin vor.\n\nViele Grüße\nIhr EcoBin-Team");
        setBookingStatus(currentKundeUid, "accepted");
      } else if (action === "pause") {
        openMailDraft(to, "Pausierung Ihres Monatsabos bei EcoBin",
          "Hallo " + name + ",\n\nwir haben Ihr Monatsabo wie gewünscht pausiert. Sobald Sie es wieder fortsetzen möchten, melden Sie sich gerne bei uns.\n\nViele Grüße\nIhr EcoBin-Team");
        setBookingStatus(currentKundeUid, "paused");
      }
    });
  });

  document.getElementById("kd-custom-send").addEventListener("click", () => {
    const b = findBookingByUid(currentKundeUid);
    if (!b) return;
    const to = fieldVal(b, ["email"], "");
    const subject = document.getElementById("kd-custom-subject").value || "Nachricht von EcoBin";
    const body = document.getElementById("kd-custom-body").value || "";
    openMailDraft(to, subject, body);
  });

  // ---------- Bestätigungs-Modal (generisch) ----------
  let confirmCallback = null;
  function openConfirmModal(text, onConfirm) {
    document.getElementById("confirm-modal-text").textContent = text;
    confirmCallback = onConfirm;
    document.getElementById("confirm-modal").style.display = "flex";
  }
  function closeConfirmModal() {
    document.getElementById("confirm-modal").style.display = "none";
    confirmCallback = null;
  }
  document.getElementById("confirm-modal-cancel").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-modal-confirm").addEventListener("click", () => {
    const cb = confirmCallback;
    closeConfirmModal();
    if (cb) cb();
  });

  // ---------- Andere Nachrichten (Postfach) ----------
  // Echte Nachrichten aus dem Gmail-Postfach von EcoBin, geladen über
  // GET /api/admin/other-messages (Worker filtert automatische
  // Buchungs-/Zahlungs-Mails bereits serverseitig heraus).
  let otherMessages = [];
  let otherMessagesLoading = true;
  let otherMessagesError = false;

  async function loadOtherMessages() {
    otherMessagesLoading = true;
    otherMessagesError = false;
    renderOtherMessages();
    try {
      const data = await api("/api/admin/other-messages");
      otherMessages = Array.isArray(data) ? data : [];
    } catch (e) {
      otherMessagesError = true;
      otherMessages = [];
    } finally {
      otherMessagesLoading = false;
      renderOtherMessages();
    }
  }

  function otherMsgCardHtml(m) {
    return (
      '<div class="mail-card">' +
      "<h4>" + escapeHtml(m.subject || "(kein Betreff)") + "</h4>" +
      '<div class="mail-row"><span class="k">Von</span><span class="v">' + escapeHtml(m.name || m.email || "Unbekannt") + "</span></div>" +
      '<div class="mail-row"><span class="k">E-Mail</span><span class="v">' + escapeHtml(m.email || "–") + "</span></div>" +
      '<div class="mail-row" style="border-bottom:0"><span class="k">Eingegangen</span><span class="v">' + formatDateDe(m.receivedAt) + "</span></div>" +
      '<p style="font-size:13px;color:var(--navy);margin:6px 0 14px;white-space:pre-wrap">' + escapeHtml(m.message || "") + "</p>" +
      '<div style="display:flex;gap:8px">' +
      '<button class="small-btn" data-msg-reply="' + m.id + '">↩ Antworten</button>' +
      '<button class="small-btn" data-msg-delete="' + m.id + '" style="border-color:var(--danger);color:var(--danger)">Löschen</button>' +
      "</div></div>"
    );
  }

  function renderOtherMessages() {
    const el = document.getElementById("pf-other-list");
    const badge = document.getElementById("pf-other-badge");
    if (!el) return;
    if (badge) badge.textContent = otherMessages.length;
    if (otherMessagesLoading) { el.innerHTML = '<div class="loading">Lädt …</div>'; return; }
    if (otherMessagesError) { el.innerHTML = '<div class="empty-state">Nachrichten konnten nicht geladen werden.</div>'; return; }
    if (!otherMessages.length) { el.innerHTML = '<div class="empty-state">Keine sonstigen Nachrichten.</div>'; return; }
    el.innerHTML = otherMessages.map(otherMsgCardHtml).join("");
    el.querySelectorAll("[data-msg-reply]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = otherMessages.find((x) => x.id === btn.dataset.msgReply);
        if (!m) return;
        openMailDraft(m.email || "", "Re: " + (m.subject || ""), "Hallo " + (m.name || "") + ",\n\n\n\nViele Grüße\nIhr EcoBin-Team");
      });
    });
    el.querySelectorAll("[data-msg-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = btn.dataset.msgDelete;
        openConfirmModal("Diese Nachricht wird aus dem Postfach entfernt und nicht mehr angezeigt.", async () => {
          btn.disabled = true;
          try {
            await api("/api/admin/other-messages/" + encodeURIComponent(msgId) + "/dismiss", { method: "POST" });
          } catch (e) {
            // Fehler wird unten still ignoriert, Liste wird trotzdem lokal bereinigt
          }
          otherMessages = otherMessages.filter((x) => x.id !== msgId);
          renderOtherMessages();
        });
      });
    });
  }

  // ---------- Kunden ----------
  let kuFilter = "all";
  let kuSearch = "";
  let currentKundenKey = null;

  function buildCustomers() {
    const map = new Map();
    bookings.forEach((b) => {
      const email = fieldVal(b, ["email"], "");
      const key = (email || b.name || "").toLowerCase().trim();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { key: key, name: b.name || "Unbekannt", email: email, phone: fieldVal(b, ["phone", "telefon", "tel"], ""), bookings: [] });
      }
      map.get(key).bookings.push(b);
    });
    return Array.from(map.values());
  }

  function customerHasActiveAbo(c) {
    return c.bookings.some((b) => b.abo && b.status === "accepted");
  }

  function kuFilteredList(list) {
    let out = list;
    if (kuFilter === "abo-active") out = out.filter(customerHasActiveAbo);
    if (kuFilter === "no-abo") out = out.filter((c) => !customerHasActiveAbo(c));
    if (kuSearch) {
      const q = kuSearch.toLowerCase();
      out = out.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q));
    }
    return out;
  }

  function kuRowHtml(c) {
    const activeAbo = customerHasActiveAbo(c);
    return (
      '<tr class="row-click" data-cuid="' + encodeURIComponent(c.key) + '">' +
      '<td class="cust"><b>' + escapeHtml(c.name) + "</b></td>" +
      "<td>" + escapeHtml(c.email || "–") + "</td>" +
      "<td>" + c.bookings.length + "</td>" +
      '<td><span class="pill ' + (activeAbo ? "pill-ok" : "pill-done") + '">' + (activeAbo ? "Abo aktiv" : "Kein Abo") + "</span></td>" +
      "</tr>"
    );
  }

  function renderKundenTable() {
    const tableEl = document.getElementById("ku-table");
    if (!tableEl) return;
    const all = buildCustomers();
    const filtered = kuFilteredList(all).slice().sort((a, c) => a.name.localeCompare(c.name));

    const counts = {
      all: all.length,
      "abo-active": all.filter(customerHasActiveAbo).length,
      "no-abo": all.filter((c) => !customerHasActiveAbo(c)).length,
    };
    Object.keys(counts).forEach((k) => {
      const cntEl = document.getElementById("ku-cnt-" + k);
      if (cntEl) cntEl.textContent = counts[k];
    });
    document.querySelectorAll("#ku-tabs .pf-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.kuFilter === kuFilter));

    if (!filtered.length) { tableEl.innerHTML = '<div class="empty-state">Keine Kunden gefunden.</div>'; return; }
    tableEl.innerHTML =
      '<table class="tbl"><thead><tr><th>Kunde</th><th>E-Mail</th><th>Buchungen</th><th>Status</th></tr></thead><tbody>' +
      filtered.map(kuRowHtml).join("") + "</tbody></table>";
    tableEl.querySelectorAll("tr[data-cuid]").forEach((tr) => {
      tr.addEventListener("click", () => showKundenDetail(decodeURIComponent(tr.dataset.cuid)));
    });
  }

  document.querySelectorAll("#ku-tabs .pf-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      kuFilter = btn.dataset.kuFilter;
      renderKundenTable();
    });
  });

  document.getElementById("ku-search").addEventListener("input", (e) => {
    kuSearch = e.target.value.trim();
    renderKundenTable();
  });

  function renderKundenDetail(c) {
    document.getElementById("ku-title").textContent = c.name;
    document.getElementById("ku-sub").textContent = c.email || "";

    const sortedBookings = c.bookings.slice().sort((a, b2) => (b2.createdAt || "").localeCompare(a.createdAt || ""));
    const latest = sortedBookings[0] || {};

    document.getElementById("ku-fields").innerHTML =
      kdRowHtml("Name", escapeHtml(c.name)) +
      kdRowHtml("E-Mail", escapeHtml(c.email || "–")) +
      kdRowHtml("Telefon", escapeHtml(c.phone || "–")) +
      kdRowHtml("Adresse", formatAddress(latest)) +
      kdRowHtml("Anzahl Buchungen", String(c.bookings.length)) +
      kdRowHtml("Abo-Status", customerHasActiveAbo(c) ? "Aktiv" : "Kein aktives Abo");

    const rows = sortedBookings.map((b) => {
      const st = statusInfo(b, todayIso());
      return (
        "<tr>" +
        "<td>" + formatDateDe(b.createdAt ? String(b.createdAt).slice(0, 10) : null) + "</td>" +
        "<td>" + formatDateDe(b.date) + "</td>" +
        "<td>" + (b.abo ? "Monatsabo" : "Einmalzahlung") + "</td>" +
        '<td class="price">' + formatEuro(b.amount) + "</td>" +
        '<td><span class="pill ' + st.cls + '">' + st.label + "</span></td>" +
        "</tr>"
      );
    }).join("");
    document.getElementById("ku-bookings").innerHTML =
      '<table class="tbl"><thead><tr><th>Buchungsdatum</th><th>Termin</th><th>Art</th><th>Betrag</th><th>Status</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  function showKundenDetail(key) {
    const c = buildCustomers().find((x) => x.key === key);
    if (!c) return;
    currentKundenKey = key;
    document.querySelectorAll(".content").forEach((el) => { el.style.display = "none"; });
    document.getElementById("view-kunden-detail").style.display = "block";
    document.querySelectorAll(".sb-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === "kunden"));
    document.getElementById("page-title").textContent = "Kunde";
    document.getElementById("page-sub").textContent = "Kundendaten und Buchungen";
    renderKundenDetail(c);
  }

  document.getElementById("ku-back").addEventListener("click", () => switchTab("kunden"));

  document.getElementById("ku-delete-btn").addEventListener("click", () => {
    const c = buildCustomers().find((x) => x.key === currentKundenKey);
    if (!c) return;
    openConfirmModal(
      "Alle Daten von " + (c.name || c.email || "diesem Kunden") + " werden unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.",
      () => {
        const keyToDelete = currentKundenKey;
        bookings = bookings.filter((b) => {
          const email = fieldVal(b, ["email"], "");
          const bKey = (email || b.name || "").toLowerCase().trim();
          return bKey !== keyToDelete;
        });
        render();
        switchTab("kunden");
      }
    );
  });

  // Mobile menu (Hamburger-Drawer)
  const sidebarEl = document.querySelector(".sidebar");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const menuBtn = document.getElementById("menu-btn");
  function openSidebar() { sidebarEl.classList.add("open"); sidebarOverlay.classList.add("open"); }
  function closeSidebar() { sidebarEl.classList.remove("open"); sidebarOverlay.classList.remove("open"); }
  if (menuBtn) menuBtn.addEventListener("click", openSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);
  document.querySelectorAll(".sb-item").forEach((btn) => btn.addEventListener("click", closeSidebar));


  // ---------- Rabattcodes ----------
  let discountCodesCache = {};
  let discountEditingCode = "";

  function normalizeDiscountCodeClient(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  }

  function renderDiscountCodes() {
    const list = document.getElementById("dc-list");
    if (!list) return;
    const entries = Object.entries(discountCodesCache || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">Noch keine Rabattcodes angelegt.</div>';
      return;
    }
    list.innerHTML = entries.map(([code, value]) => {
      const percent = Number(value && typeof value === "object" ? value.percent : value) || 0;
      return '<div class="dc-item"><div><div class="dc-code">' + escapeHtml(code) + '</div><div class="dc-percent">' + percent + '% Rabatt</div></div><div class="dc-actions"><button type="button" class="dc-action" data-dc-edit="' + escapeAttr(code) + '">Bearbeiten</button><button type="button" class="dc-action delete" data-dc-delete="' + escapeAttr(code) + '">Löschen</button></div></div>';
    }).join("");

    list.querySelectorAll("[data-dc-edit]").forEach((btn) => btn.addEventListener("click", () => {
      const code = btn.dataset.dcEdit || "";
      const value = discountCodesCache[code];
      document.getElementById("dc-code").value = code;
      document.getElementById("dc-percent").value = Number(value && typeof value === "object" ? value.percent : value) || 0;
      discountEditingCode = code;
      document.getElementById("dc-add-btn").textContent = "Speichern";
      document.getElementById("dc-cancel-btn").style.display = "";
    }));

    list.querySelectorAll("[data-dc-delete]").forEach((btn) => btn.addEventListener("click", async () => {
      const code = btn.dataset.dcDelete || "";
      if (!confirm('Rabattcode „' + code + '“ wirklich löschen?')) return;
      try {
        const res = await api("/api/admin/discount-codes/" + encodeURIComponent(code), { method: "DELETE" });
        if (res && res.error) throw new Error(res.error);
        discountCodesCache = res.codes || {};
        renderDiscountCodes();
      } catch (e) {
        alert("Löschen fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler"));
      }
    }));
  }

  function escapeAttr(value) {
    return String(value || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  async function loadDiscountCodes() {
    const statusEl = document.getElementById("dc-status");
    const wrap = document.getElementById("dc-fields-wrap");
    if (!statusEl || !wrap) return;
    statusEl.textContent = "Lädt …";
    statusEl.style.display = "block";
    wrap.style.display = "none";
    try {
      const data = await api("/api/admin/discount-codes");
      if (data && data.error) throw new Error(data.error);
      discountCodesCache = data || {};
      statusEl.style.display = "none";
      wrap.style.display = "block";
      renderDiscountCodes();
    } catch (e) {
      statusEl.textContent = "Rabattcodes konnten nicht geladen werden. " + (e && e.message ? e.message : "");
      statusEl.style.color = "#b42318";
      wrap.style.display = "block";
    }
  }

  const dcAddBtn = document.getElementById("dc-add-btn");
  const dcCancelBtn = document.getElementById("dc-cancel-btn");
  if (dcAddBtn) dcAddBtn.addEventListener("click", async () => {
    const codeInput = document.getElementById("dc-code");
    const percentInput = document.getElementById("dc-percent");
    const saveMsg = document.getElementById("dc-save-msg");
    const code = normalizeDiscountCodeClient(codeInput && codeInput.value);
    const percent = Number(percentInput && percentInput.value);

    if (!code || !/^[A-Z0-9_-]+$/.test(code)) {
      alert("Bitte einen gültigen Rabattcode eingeben.");
      return;
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      alert("Der Rabatt muss zwischen 0 und 100 % liegen.");
      return;
    }

    const original = dcAddBtn.textContent;
    dcAddBtn.disabled = true;
    dcAddBtn.textContent = "Speichert …";
    try {
      const payload = {};
      payload[code] = { percent: Math.round(percent * 100) / 100 };
      const data = await api("/api/admin/discount-codes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (data && data.error) throw new Error(data.error);
      discountCodesCache = data || {};
      codeInput.value = "";
      percentInput.value = "";
      discountEditingCode = "";
      dcCancelBtn.style.display = "none";
      dcAddBtn.textContent = "＋ Rabattcode hinzufügen";
      renderDiscountCodes();
      if (saveMsg) {
        saveMsg.textContent = "✓ Gespeichert";
        saveMsg.style.display = "inline";
        setTimeout(() => { saveMsg.style.display = "none"; }, 2200);
      }
    } catch (e) {
      alert("Speichern fehlgeschlagen: " + (e && e.message ? e.message : "unbekannter Fehler"));
      dcAddBtn.textContent = original;
    } finally {
      dcAddBtn.disabled = false;
    }
  });

  if (dcCancelBtn) dcCancelBtn.addEventListener("click", () => {
    discountEditingCode = "";
    const codeInput = document.getElementById("dc-code");
    const percentInput = document.getElementById("dc-percent");
    if (codeInput) codeInput.value = "";
    if (percentInput) percentInput.value = "";
    dcCancelBtn.style.display = "none";
    if (dcAddBtn) dcAddBtn.textContent = "＋ Rabattcode hinzufügen";
  });

  // Start
  if (token) {
    api("/api/admin/bookings?status=pending").then(() => showApp()).catch(() => showLogin(false));
  } else {
    showLogin(false);
  }
})();