/* ============================================================
   EcoBin – PayPal Backend (Cloudflare Worker)
   ------------------------------------------------------------
   Kann jetzt:
     1) Einmalzahlung erstellen        -> POST /api/orders
     2) Einmalzahlung erfassen         -> POST /api/orders/<ID>/capture
     3) Abo-Plan EINMALIG anlegen      -> GET  /api/setup-plan
     4) Abo anlegen                    -> POST /api/subscriptions
     5) Abo serverseitig bestätigen    -> POST /api/subscriptions/<ID>/confirm
     6) Öffentliche PayPal-Konfig      -> GET  /api/config
     7) Abo-Status ansehen (Kunde)     -> GET  /api/subscriptions/manage?token=...
     8) Abo kündigen (Kunde)           -> POST /api/subscriptions/cancel
     9) PayPal-Webhooks empfangen      -> POST /api/webhooks/paypal
    10) Admin: Buchungen auflisten     -> GET  /api/admin/bookings?status=pending|accepted|rejected|all
    11) Admin: Buchungsdetails         -> GET  /api/admin/bookings/<ID>
    12) Admin: Buchung annehmen        -> POST /api/admin/bookings/<ID>/accept
    13) Admin: Buchung ablehnen        -> POST /api/admin/bookings/<ID>/reject
    14) Preise auslesen (öffentlich)   -> GET  /api/config (Feld "prices")
    15) Preise ändern (Admin)          -> PUT  /api/admin/prices (Auth: Bearer ADMIN_TOKEN)
    16) E-Mail-Vorlagen laden (Admin)  -> GET  /api/admin/email-templates (Auth: Bearer ADMIN_TOKEN)
    17) E-Mail-Vorlagen speichern      -> PUT  /api/admin/email-templates (Auth: Bearer ADMIN_TOKEN)

   INTERNE BUCHUNGSVERWALTUNG (NEU, additiv, siehe /admin)
   ---------------------------------------------------------------
   Sobald eine Zahlung erfolgreich erfasst (captureOrder) bzw. ein Abo
   serverseitig bestätigt wird (confirmSubscription), wird zusätzlich zur
   bisherigen Benachrichtigungs-E-Mail EIN persistenter Buchungsdatensatz
   unter KV-Key "booking:<orderID|subscriptionId>" mit Status "pending"
   angelegt (siehe createPendingBooking). Über die neuen /api/admin/*
   Endpunkte (geschützt durch ADMIN_TOKEN, siehe unten) kann dieser
   Datensatz eingesehen und auf "accepted"/"rejected" gesetzt werden.

   WICHTIG (GEÄNDERT): Beim Annehmen/Ablehnen einer Buchung verschickt
   der Worker KEINE E-Mail mehr automatisch. Stattdessen liefert
   decideBooking() einen fertigen E-Mail-Entwurf (an/Betreff/Text) an das
   Admin-Panel zurück. Das Admin-Panel öffnet damit Gmail mit
   vorausgefüllter Mail – der Admin prüft sie und verschickt sie manuell.
   Der Entwurf nutzt seit diesem Schritt die unter /api/admin/email-
   templates gespeicherte Vorlage ("Buchung angenommen"/"Buchung
   abgelehnt"), inkl. bereits vorhandener Kundendaten (Name, Datum,
   Tonnen, Extras, Art, Preis, Adresse über {{platzhalter}}). Ist keine
   Vorlage gespeichert (Betreff oder Nachricht leer), wird weiterhin der
   bisherige fest codierte E-Mail-Text verwendet (siehe buildDecisionEmail).
   Grund: Der bisherige automatische Versand über den Resend-Testabsender
   "onboarding@resend.dev" kam beim Kunden nicht zuverlässig an (siehe
   Hinweis bei sendEmail/FROM_EMAIL weiter unten), es wurde aber trotzdem
   "E-Mail wurde verschickt" angezeigt. Am bestehenden PayPal-Zahlungsablauf
   (Orders, Abos, Webhooks) ändert das NICHTS – die Zahlung ist zu diesem
   Zeitpunkt bereits abgeschlossen (siehe Hinweis in PROJECT_STATUS.md zum
   Thema "Ablehnen nach bereits erfolgter Zahlung").

   PREISE & PRODUKTE (NEU, additiv)
   ---------------------------------------------------------------
   Alle Preise (Tonnen-Reinigung, Extras, Monatsabo-Rabatt) liegen jetzt
   zentral im KV unter dem Key "config:prices" statt fest im Website-Code.
   GET /api/config liefert sie öffentlich mit aus (Website liest sie beim
   Laden). Die Verwaltung ändert sie über GET/PUT /api/admin/prices,
   geschützt mit demselben ADMIN_TOKEN wie die übrigen Admin-Endpunkte.

   ECHTES MONATSABO
   -----------------
   Das Abo wird über die PayPal Subscriptions API (v1/billing/subscriptions)
   angelegt. PayPal bucht danach jeden Monat automatisch den hinterlegten
   Betrag ab, bis das Abo gekündigt wird (billing_cycles -> total_cycles: 0
   = unbegrenzt, siehe setupPlan/createSubscription).

   SELBST-KÜNDIGUNG DURCH DEN KUNDEN (sicher, ohne Login-System)
   ---------------------------------------------------------------
   Beim Bestätigen des Abos (confirmSubscription) wird ein zufälliger,
   nicht erratbarer "Verwaltungs-Token" (192 Bit Zufall) erzeugt und mit
   der Subscription-ID verknüpft (KV: "tok:<token>" -> subscriptionId).
   Nur wer diesen Token/Link kennt, kann den Status abrufen oder das Abo
   kündigen – ein Kunde kann also niemals die Subscription-ID eines
   anderen Kunden erraten oder kündigen. Der Link wird dem Kunden direkt
   nach der Buchung angezeigt UND in der Buchungs-E-Mail an EcoBin
   mitgeschickt (damit ihr ihn bei Bedarf erneut zusenden könnt – siehe
   Hinweis zu Resend weiter unten).

   WEBHOOKS
   --------
   Alle sicherheitsrelevanten Aktionen (Zahlung erfolgreich, Zahlung
   fehlgeschlagen, Kündigung) werden zusätzlich über echte, bei PayPal
   verifizierte Webhooks abgesichert – nicht nur über die Aktionen im
   Frontend. So bekommt EcoBin auch dann Bescheid, wenn eine Abbuchung
   direkt bei PayPal (ohne Website-Interaktion) passiert.

   ANDERE NACHRICHTEN AUS GMAIL (NEU)
   ---------------------------------------------------------------
   Damit im Admin-Panel unter "Postfach -> Andere Nachrichten" echte,
   nicht-automatische E-Mails aus dem Gmail-Postfach von EcoBin
   (ecobin.badvilbel@gmail.com) angezeigt werden, ruft der Worker über
   die Gmail-API die neuesten Nachrichten im Posteingang ab und filtert
   dabei alle automatischen Benachrichtigungen heraus, die der Worker
   selbst über Resend verschickt hat (erkennbar am Absender
   "onboarding@resend.dev", siehe FROM_EMAIL). Übrig bleiben "echte"
   Nachrichten von Kunden oder Dritten.

   Voraussetzung: Ein Google-Cloud-Projekt mit aktivierter Gmail-API und
   einem OAuth-Refresh-Token für das Konto ecobin.badvilbel@gmail.com
   mit Scope "https://www.googleapis.com/auth/gmail.modify" (modify wird
   benötigt, damit "Löschen" im Admin-Panel die Nachricht auch in Gmail
   in den Papierkorb verschieben kann).

   Secrets/Vars (Cloudflare Worker):
     PAYPAL_CLIENT_ID       - PayPal Client ID (Sandbox oder Live)
     PAYPAL_CLIENT_SECRET   - PayPal Client Secret (Sandbox oder Live)
     PAYPAL_WEBHOOK_ID      - Webhook-ID aus dem PayPal Dashboard
     PAYPAL_PLAN_ID         - Abo-Plan-ID (P-...) aus /api/setup-plan
     PAYPAL_ENV             - "live" für Live-Betrieb, sonst Sandbox
     RESEND_API_KEY         - für den E-Mail-Versand (wie bisher)
     NOTIFY_EMAIL           - optional, überschreibt die EcoBin-Zielmail
     SITE_URL               - optional, z. B. https://ecobin-badvilbel.de
                               (für den Verwaltungslink in E-Mails)
     ADMIN_TOKEN             - Geheimes Passwort/Token für den Zugriff
                               auf /admin und die /api/admin/* Endpunkte
                               (inkl. /api/admin/prices).
                               Als Secret setzen:
                               wrangler secret put ADMIN_TOKEN
     GMAIL_CLIENT_ID         - NEU. OAuth-Client-ID aus Google Cloud
     GMAIL_CLIENT_SECRET     - NEU. OAuth-Client-Secret aus Google Cloud
     GMAIL_REFRESH_TOKEN     - NEU. Refresh-Token für
                               ecobin.badvilbel@gmail.com (siehe oben)
                               Alle drei als Secrets setzen:
                               wrangler secret put GMAIL_CLIENT_ID
                               wrangler secret put GMAIL_CLIENT_SECRET
                               wrangler secret put GMAIL_REFRESH_TOKEN

   KV-Bindung: ORDERS (wie bisher; wird jetzt zusätzlich für dauerhafte
   Abo-Datensätze, Webhook-Idempotenz, persistente Buchungsdatensätze
   ("booking:<id>") für die Admin-Verwaltung UND die zentrale Preis-
   Konfiguration ("config:prices") genutzt)
   ============================================================ */

const ALLOWED_ORIGIN = "*";
const DEFAULT_NOTIFY_EMAIL = "mikaback777@gmail.com";
const FROM_EMAIL = "EcoBin <onboarding@resend.dev>"; // Absender ohne eigene Domain-Verifizierung
const AUTOMATED_SENDER = "onboarding@resend.dev"; // Absender der Worker-eigenen Benachrichtigungs-Mails

// Typische Muster automatischer Absender (Anmelde-Benachrichtigungen, Sicherheits-
// hinweise, Newsletter, System-Mails etc.), die NICHT unter "Andere Nachrichten"
// erscheinen sollen, auch wenn Gmail sie in die Hauptkategorie einsortiert.
const AUTOMATED_SENDER_PATTERNS = [
  "no-reply", "noreply", "do-not-reply", "donotreply",
  "notification", "notifications", "notify@",
  "alert", "security@", "mailer-daemon", "postmaster",
  "@accounts.google.com", "@google.com",
];

function isAutomatedSender(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.includes(AUTOMATED_SENDER)) return true;
  return AUTOMATED_SENDER_PATTERNS.some((p) => e.includes(p));
}

function paypalApiBase(env) {
  return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
function notifyEmail(env) {
  return env.NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL;
}

/* ============================================================
   PREISE & PRODUKTE (zentral in der KV gespeichert, ORDERS-Binding)
   ------------------------------------------------------------
   Wird über /api/config oeffentlich ausgeliefert (Website + PayPal-
   Buttons lesen von dort) und ueber /api/admin/prices (geschuetzt mit
   ADMIN_TOKEN, siehe checkAdminAuth weiter unten) von der Verwaltung
   geaendert. So gibt es nur noch EINE Quelle fuer alle Preise statt
   fest codierter Werte im Frontend.
   ============================================================ */
const PRICE_KEY = "config:prices";
const DEFAULT_PRICES = {
  binBase: 10, // erste "normale" Tonne (Bio/Rest/Gelb/Papier/Sonstige)
  binAdditional: 5, // jede weitere "normale" Tonne
  binGross: 15, // Große Mülltonne, fest je Stück
  binContainer: 30, // Container, fest je Stück
  extraDuft: 5, // Extra: Duft-Frische
  extraPulver: 5, // Extra: BioTonnen Frischepulver
  extraWasser: 5, // Extra: EcoBin Wasser-Service
  aboDiscountPercent: 10, // Monatsabo-Rabatt auf den Tonnen-Grundpreis
};
async function getPrices(env) {
  if (!env.ORDERS) return Object.assign({}, DEFAULT_PRICES);
  try {
    const raw = await env.ORDERS.get(PRICE_KEY);
    if (!raw) return Object.assign({}, DEFAULT_PRICES);
    return Object.assign({}, DEFAULT_PRICES, JSON.parse(raw));
  } catch (_) {
    return Object.assign({}, DEFAULT_PRICES);
  }
}
async function savePrices(env, prices) {
  if (!env.ORDERS) throw new Error("Kein KV-Speicher verfügbar");
  await env.ORDERS.put(PRICE_KEY, JSON.stringify(prices));
}
function sanitizePrices(body) {
  body = body || {};
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    if (!isFinite(n) || n < min || n > max) return fallback;
    return Math.round(n * 100) / 100;
  };
  return {
    binBase: num(body.binBase, DEFAULT_PRICES.binBase, 0, 500),
    binAdditional: num(body.binAdditional, DEFAULT_PRICES.binAdditional, 0, 500),
    binGross: num(body.binGross, DEFAULT_PRICES.binGross, 0, 500),
    binContainer: num(body.binContainer, DEFAULT_PRICES.binContainer, 0, 1000),
    extraDuft: num(body.extraDuft, DEFAULT_PRICES.extraDuft, 0, 200),
    extraPulver: num(body.extraPulver, DEFAULT_PRICES.extraPulver, 0, 200),
    extraWasser: num(body.extraWasser, DEFAULT_PRICES.extraWasser, 0, 200),
    aboDiscountPercent: num(body.aboDiscountPercent, DEFAULT_PRICES.aboDiscountPercent, 0, 100),
  };
}

/* ============================================================
   E-MAIL-VORLAGEN (zentral in der KV gespeichert, ORDERS-Binding)
   ------------------------------------------------------------
   Einfaches Vorlagensystem für genau zwei feste Vorlagen:
   "booking_accepted" und "booking_rejected". Jede Vorlage besteht
   nur aus subject + body. Wird über /api/admin/email-templates
   (GET zum Laden, PUT zum Speichern) verwaltet, geschützt mit
   demselben ADMIN_TOKEN wie die übrigen Admin-Endpunkte. Bewusst
   ohne Verknüpfung zu decideBooking()/buildAcceptedEmail() – das
   ist eine spätere Erweiterung, kein Teil dieser Hauptfunktion.
   ============================================================ */
const EMAIL_TEMPLATES_KEY = "config:emailTemplates";
const EMAIL_TEMPLATE_TYPES = ["booking_accepted", "booking_rejected"];
const DEFAULT_EMAIL_TEMPLATES = {
  booking_accepted: { subject: "", body: "" },
  booking_rejected: { subject: "", body: "" },
};
async function getEmailTemplates(env) {
  if (!env.ORDERS) return JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES));
  try {
    const raw = await env.ORDERS.get(EMAIL_TEMPLATES_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES));
    const stored = JSON.parse(raw);
    const out = {};
    for (const t of EMAIL_TEMPLATE_TYPES) {
      out[t] = {
        subject: (stored[t] && stored[t].subject) || "",
        body: (stored[t] && stored[t].body) || "",
      };
    }
    return out;
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES));
  }
}
async function saveEmailTemplates(env, templates) {
  if (!env.ORDERS) throw new Error("Kein KV-Speicher verfügbar");
  await env.ORDERS.put(EMAIL_TEMPLATES_KEY, JSON.stringify(templates));
}
function sanitizeEmailTemplates(body) {
  body = body || {};
  const str = (v) => (typeof v === "string" ? v.slice(0, 20000) : "");
  const out = {};
  for (const t of EMAIL_TEMPLATE_TYPES) {
    const tpl = body[t] || {};
    out[t] = { subject: str(tpl.subject), body: str(tpl.body) };
  }
  return out;
}

// Ersetzt Platzhalter der Form {{platzhalter}} in Betreff/Nachricht einer
// gespeicherten Vorlage durch die bereits vorhandenen Kundendaten der
// Buchung. Unbekannte Platzhalter bleiben unverändert stehen (kein Fehler).
function fillEmailPlaceholders(text, rec) {
  if (!text) return text;
  const map = {
    name: rec.name || "",
    email: rec.email || "",
    datum: formatDateDe(rec.date),
    tonnen: rec.binTypes || "-",
    extras: rec.extras && rec.extras !== "keine" ? rec.extras : "-",
    art: rec.abo ? "Monatsabo" : "Einmalige Reinigung",
    preis: rec.amount ? String(rec.amount).replace(".", ",") + " €" : "-",
    adresse: rec.address || "-",
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : match;
  });
}

// Baut den E-Mail-Entwurf für decideBooking(): nutzt die gespeicherte
// Vorlage ("booking_accepted"/"booking_rejected"), sofern für den
// jeweiligen Status Betreff UND Nachricht gespeichert sind, und setzt
// dabei die bereits vorhandenen Kundendaten der Buchung ein. Ist keine
// Vorlage gespeichert, greift der bisherige fest codierte E-Mail-Text
// (buildAcceptedEmail/buildRejectedEmail) als Fallback.
async function buildDecisionEmail(rec, newStatus, env) {
  if (!rec.email) return null;
  const templateKey = newStatus === "accepted" ? "booking_accepted" : "booking_rejected";
  const fallback = newStatus === "accepted" ? buildAcceptedEmail(rec) : buildRejectedEmail(rec);
  let templates;
  try {
    templates = await getEmailTemplates(env);
  } catch (_) {
    return fallback;
  }
  const tpl = templates && templates[templateKey];
  const hasTemplate = tpl && tpl.subject && tpl.subject.trim() && tpl.body && tpl.body.trim();
  if (!hasTemplate) return fallback;
  return {
    to: rec.email,
    subject: fillEmailPlaceholders(tpl.subject, rec),
    text: fillEmailPlaceholders(tpl.body, rec),
  };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledNotifications(env));
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleCors();
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/config" && request.method === "GET") {
        return jsonResponse({
          clientId: env.PAYPAL_CLIENT_ID || null,
          planId: env.PAYPAL_PLAN_ID || null,
          env: env.PAYPAL_ENV === "live" ? "live" : "sandbox",
          prices: await getPrices(env),
        });
      }
      if (url.pathname === "/api/orders" && request.method === "POST") {
        const body = await request.json();
        return jsonResponse(await createOrder(body, env));
      }
      if (url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/capture") && request.method === "POST") {
        const orderID = url.pathname.split("/")[3];
        return jsonResponse(await captureOrder(orderID, env));
      }
      if (url.pathname === "/api/subscriptions" && request.method === "POST") {
        const body = await request.json();
        return jsonResponse(await createSubscription(body, env));
      }
      if (
        url.pathname.startsWith("/api/subscriptions/") &&
        url.pathname.endsWith("/confirm") &&
        request.method === "POST"
      ) {
        const subID = url.pathname.split("/")[3];
        return jsonResponse(await confirmSubscription(subID, env));
      }
      if (url.pathname === "/api/subscriptions/manage" && request.method === "GET") {
        const token = url.searchParams.get("token") || "";
        return jsonResponse(await getSubscriptionStatus(token, env));
      }
      if (url.pathname === "/api/subscriptions/cancel" && request.method === "POST") {
        const body = await request.json();
        return jsonResponse(await cancelSubscriptionByToken(body.token || "", env));
      }
      if (url.pathname === "/api/webhooks/paypal" && request.method === "POST") {
        return await handlePaypalWebhook(request, env);
      }
      if (url.pathname === "/api/setup-plan" && request.method === "GET") {
        return jsonResponse(await setupPlan(env));
      }

      /* -------- Admin: interne Buchungsverwaltung -------- */
      if (url.pathname === "/api/admin/bookings" && request.method === "GET") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const status = url.searchParams.get("status") || "pending";
        return jsonResponse(await listBookings(env, status));
      }
      if (
        url.pathname.startsWith("/api/admin/bookings/") &&
        url.pathname.endsWith("/accept") &&
        request.method === "POST"
      ) {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const id = decodeURIComponent(url.pathname.split("/")[4] || "");
        return jsonResponse(await decideBooking(id, "accepted", env));
      }
      if (
        url.pathname.startsWith("/api/admin/bookings/") &&
        url.pathname.endsWith("/reject") &&
        request.method === "POST"
      ) {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const id = decodeURIComponent(url.pathname.split("/")[4] || "");
        return jsonResponse(await decideBooking(id, "rejected", env));
      }
      if (
        url.pathname.startsWith("/api/admin/bookings/") &&
        url.pathname.endsWith("/cancel") &&
        request.method === "POST"
      ) {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const id = decodeURIComponent(url.pathname.split("/")[4] || "");
        return jsonResponse(await cancelAdminBooking(id, env));
      }
      if (url.pathname.startsWith("/api/admin/bookings/") && request.method === "GET") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const id = decodeURIComponent(url.pathname.split("/")[4] || "");
        return jsonResponse(await getBooking(env, id));
      }

      /* -------- Admin: Preise & Produkte (NEU) -------- */
      if (url.pathname === "/api/admin/prices" && request.method === "GET") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        return jsonResponse(await getPrices(env));
      }
      if (url.pathname === "/api/admin/prices" && request.method === "PUT") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const body = await request.json();
        const prices = sanitizePrices(body);
        await savePrices(env, prices);
        return jsonResponse(prices);
      }

      /* -------- Admin: E-Mail-Vorlagen (NEU) -------- */
      if (url.pathname === "/api/admin/email-templates" && request.method === "GET") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        return jsonResponse(await getEmailTemplates(env));
      }
      if (url.pathname === "/api/admin/email-templates" && request.method === "PUT") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const body = await request.json();
        const templates = sanitizeEmailTemplates(body);
        await saveEmailTemplates(env, templates);
        return jsonResponse(templates);
      }

      /* -------- Admin: Andere Nachrichten (Gmail) (NEU) -------- */
      if (url.pathname === "/api/admin/other-messages" && request.method === "GET") {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        return jsonResponse(await listOtherMessages(env));
      }
      if (
        url.pathname.startsWith("/api/admin/other-messages/") &&
        url.pathname.endsWith("/dismiss") &&
        request.method === "POST"
      ) {
        if (!checkAdminAuth(request, env)) return jsonResponse({ error: "Nicht autorisiert" }, 401);
        const id = decodeURIComponent(url.pathname.split("/")[4] || "");
        return jsonResponse(await dismissOtherMessage(env, id));
      }

      return jsonResponse({ error: "Nicht gefunden" }, 404);
    } catch (err) {
      console.error("Worker-Fehler:", err.message);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

async function getAccessToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("PayPal-Zugriffstoken konnte nicht abgerufen werden");
  return data.access_token;
}

/* ============================================================
   EINMALZAHLUNG (unverändert zur bisherigen Logik)
   ============================================================ */
async function createOrder(body, env) {
  const token = await getAccessToken(env);
  const amount = sanitizeAmount(body.amount, "10.00");
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "EUR", value: amount }, description: body.description || "EcoBin Mülltonnenreinigung" }],
    }),
  });
  const order = await res.json();

  if (order.id && env.ORDERS) {
    await env.ORDERS.put(order.id, JSON.stringify({ booking: body.booking || {}, amount }), {
      expirationTtl: 60 * 60 * 24, // 24h – danach automatisch geloescht
    });
  }
  return order;
}

async function captureOrder(orderID, env) {
  const token = await getAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${orderID}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const result = await res.json();

  if (result.status !== "COMPLETED") {
    const storedFailure = env.ORDERS ? await env.ORDERS.get(orderID) : null;
    const failureData = storedFailure ? JSON.parse(storedFailure) : {};
    await sendOneTimePaymentFailedEmail(env, {
      name: failureData.booking?.name,
      email: failureData.booking?.email,
      orderID,
      amount: failureData.amount,
      status: result.status,
      error: result.name || result.message || result.details?.[0]?.description || "Unbekannter PayPal-Fehler",
    });
  }

  if (result.status === "COMPLETED" && env.ORDERS) {
    const stored = await env.ORDERS.get(orderID);
    if (stored) {
      const { booking, amount } = JSON.parse(stored);
      const capturedAmount =
        result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || amount;
      const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
      await sendOneTimePaymentSuccessEmail(env, {
        name: booking?.name,
        email: booking?.email,
        orderID,
        amount: capturedAmount,
        currency: capture?.amount?.currency_code || "EUR",
        paymentDate: new Date().toISOString(),
        transactionId: capture?.id || orderID,
      });
      await sendBookingEmail(env, {
        typ: "Einmalzahlung",
        orderID,
        amount: capturedAmount,
        booking,
      });

      // Persistenten Buchungsdatensatz (Status "pending") für die
      // interne Admin-Verwaltung anlegen. Ändert nichts am Zahlungsablauf.
      await createPendingBooking(env, {
        id: orderID,
        type: "einmalig",
        booking,
        amount: capturedAmount,
        paypalRef: orderID,
      });

      await env.ORDERS.delete(orderID);
    }
  }
  return result;
}

/* ============================================================
   ABO-PLAN EINMALIG ANLEGEN
   ============================================================ */
async function setupPlan(env) {
  const token = await getAccessToken(env);

  const prodRes = await fetch(`${paypalApiBase(env)}/v1/catalogs/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: "EcoBin Mülltonnenreinigung",
      type: "SERVICE",
      category: "MERCHANDISE",
    }),
  });
  const product = await prodRes.json();
  if (!product.id) return { error: "Produkt konnte nicht angelegt werden", details: product };

  const planRes = await fetch(`${paypalApiBase(env)}/v1/billing/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      product_id: product.id,
      name: "EcoBin Monatsabo",
      description: "Monatliche Mülltonnenreinigung – Betrag je nach Buchung",
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0, // 0 = unbegrenzt, läuft bis zur Kündigung
          pricing_scheme: { fixed_price: { value: "9", currency_code: "EUR" } },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: "0", currency_code: "EUR" },
        setup_fee_failure_action: "CONTINUE",
        payment_failure_threshold: 1,
      },
    }),
  });
  const plan = await planRes.json();
  return {
    product_id: product.id,
    plan_id: plan.id,
    status: plan.status,
    hinweis: "Trage plan_id als PAYPAL_PLAN_ID in den Worker-Umgebungsvariablen ein.",
  };
}

/* ============================================================
   ABO ANLEGEN
   ============================================================ */
async function createSubscription(body, env) {
  const token = await getAccessToken(env);
  const amount = sanitizeAmount(body.amount, "9.00");
  const planId = body.plan_id || env.PAYPAL_PLAN_ID;
  if (!planId) return { error: "plan_id fehlt" };

  const res = await fetch(`${paypalApiBase(env)}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "PayPal-Request-Id": "ecobin-" + Date.now(),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      plan_id: planId,
      plan: {
        billing_cycles: [
          { sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: amount, currency_code: "EUR" } } },
        ],
      },
    }),
  });
  const sub = await res.json();

  if (sub.id && env.ORDERS) {
    await env.ORDERS.put("sub:" + sub.id, JSON.stringify({ booking: body.booking || {}, amount }), {
      expirationTtl: 60 * 60 * 24,
    });
  }
  return sub;
}

/* ============================================================
   ABO SERVERSEITIG BESTÄTIGEN
   Erst wenn PayPal das Abo als ACTIVE/APPROVED bestätigt:
     - Buchungs-E-Mail an EcoBin
     - dauerhafter Abo-Datensatz + Verwaltungs-Token anlegen
     - Verwaltungslink an den Kunden schicken (best effort)
   ============================================================ */
async function confirmSubscription(subID, env) {
  const token = await getAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v1/billing/subscriptions/${subID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sub = await res.json();

  let manageToken = null;

  if ((sub.status === "ACTIVE" || sub.status === "APPROVED") && env.ORDERS) {
    const key = "sub:" + subID;
    const stored = await env.ORDERS.get(key);

    // Falls bereits ein Datensatz existiert (z. B. doppelter confirm-Aufruf),
    // bestehenden Token wiederverwenden statt einen zweiten zu erzeugen.
    const existingRecord = await env.ORDERS.get("subrec:" + subID);
    manageToken = existingRecord ? JSON.parse(existingRecord).manageToken : generateToken();

    if (stored) {
      const { booking, amount } = JSON.parse(stored);
      const b = booking || {};

      await sendBookingEmail(env, {
        typ: "Monatsabo",
        orderID: subID,
        amount,
        booking,
        manageToken,
      });

      await env.ORDERS.put(
        "subrec:" + subID,
        JSON.stringify({
          subscriptionId: subID,
          name: b.name || "",
          email: b.email || "",
          amount,
          manageToken,
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
          lastPaymentAt: null,
        })
      );
      await env.ORDERS.put("tok:" + manageToken, subID);
      await env.ORDERS.delete(key);

      // Persistenten Buchungsdatensatz (Status "pending") für die
      // interne Admin-Verwaltung anlegen. Ändert nichts am Abo-Ablauf.
      await createPendingBooking(env, {
        id: subID,
        type: "abo",
        booking,
        amount,
        paypalRef: subID,
      });

      if (b.email) {
        await sendCustomerManageLinkEmail(env, { name: b.name, email: b.email, manageToken, amount });
      }
    } else if (!existingRecord) {
      // Kein gespeicherter Buchungsdatensatz mehr gefunden (z. B. abgelaufen) -
      // trotzdem einen minimalen Datensatz anlegen, damit Kündigung möglich bleibt.
      await env.ORDERS.put(
        "subrec:" + subID,
        JSON.stringify({
          subscriptionId: subID,
          name: "",
          email: "",
          amount: null,
          manageToken,
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
          lastPaymentAt: null,
        })
      );
      await env.ORDERS.put("tok:" + manageToken, subID);
    }
  }

  return { status: sub.status, manageToken };
}

/* ============================================================
   KUNDEN-STATUS (per Verwaltungs-Token)
   ============================================================ */
async function getSubscriptionStatus(manageToken, env) {
  if (!manageToken || !env.ORDERS) return { error: "Ungültiger Link" };
  const subID = await env.ORDERS.get("tok:" + manageToken);
  if (!subID) return { error: "Ungültiger oder abgelaufener Link" };

  const recordRaw = await env.ORDERS.get("subrec:" + subID);
  const record = recordRaw ? JSON.parse(recordRaw) : null;

  const token = await getAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v1/billing/subscriptions/${subID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sub = await res.json();

  return {
    subscriptionId: subID,
    status: sub.status || record?.status || "UNBEKANNT",
    amount: record?.amount || sub.billing_info?.last_payment?.amount?.value || null,
    nextBillingTime: sub.billing_info?.next_billing_time || null,
    name: record?.name || "",
  };
}

/* ============================================================
   KUNDEN-KÜNDIGUNG (per Verwaltungs-Token)
   ============================================================ */
async function cancelSubscriptionByToken(manageToken, env) {
  if (!manageToken || !env.ORDERS) return { error: "Ungültiger Link" };
  const subID = await env.ORDERS.get("tok:" + manageToken);
  if (!subID) return { error: "Ungültiger oder abgelaufener Link" };

  const token = await getAccessToken(env);
  const cancelRes = await fetch(`${paypalApiBase(env)}/v1/billing/subscriptions/${subID}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: "Kunde hat über die EcoBin-Website gekündigt" }),
  });

  // PayPal antwortet bei Erfolg mit 204 No Content
  if (cancelRes.status !== 204 && cancelRes.status !== 200) {
    let details = null;
    try {
      details = await cancelRes.json();
    } catch (_) {}
    return { error: "Kündigung bei PayPal fehlgeschlagen", details };
  }

  const recordRaw = await env.ORDERS.get("subrec:" + subID);
  const record = recordRaw ? JSON.parse(recordRaw) : {};
  const cancelledAt = new Date().toISOString();
  const updated = { ...record, subscriptionId: subID, status: "CANCELLED", cancelledAt };
  await env.ORDERS.put("subrec:" + subID, JSON.stringify(updated));

  await sendCancellationEmail(env, {
    name: record.name,
    email: record.email,
    subscriptionId: subID,
    cancelledAt,
    lastPaymentAt: record.lastPaymentAt,
    source: "Kunde (Website)",
  });

  return { status: "CANCELLED" };
}

/* ============================================================
   PAYPAL-WEBHOOKS
   ============================================================ */
async function handlePaypalWebhook(request, env) {
  const rawBody = await request.text();
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_) {
    return jsonResponse({ error: "Ungültiger Webhook-Body" }, 400);
  }

  const verified = await verifyWebhookSignature(request, rawBody, env);
  if (!verified) {
    console.error("Webhook-Signatur ungültig, Event abgelehnt:", event.event_type);
    return jsonResponse({ error: "Signatur ungültig" }, 400);
  }

  // Idempotenz: jedes PayPal-Event hat eine eindeutige id. Wurde es bereits
  // verarbeitet, brechen wir sofort ab, um doppelte E-Mails zu vermeiden.
  const eventId = event.id;
  if (eventId && env.ORDERS) {
    const already = await env.ORDERS.get("evt:" + eventId);
    if (already) return jsonResponse({ ok: true, duplicate: true });
    await env.ORDERS.put("evt:" + eventId, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  }

  try {
    await routeWebhookEvent(event, env);
  } catch (err) {
    console.error("Fehler bei Webhook-Verarbeitung:", err.message);
    // Trotzdem 200 zurückgeben, damit PayPal das (bereits als verarbeitet
    // markierte) Event nicht endlos wiederholt; der Fehler steht im Log.
  }
  return jsonResponse({ ok: true });
}

async function verifyWebhookSignature(request, rawBody, env) {
  if (!env.PAYPAL_WEBHOOK_ID) {
    console.error("PAYPAL_WEBHOOK_ID nicht gesetzt – Webhook kann nicht verifiziert werden");
    return false;
  }
  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");
  const transmissionSig = request.headers.get("paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return false;

  const token = await getAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  const result = await res.json();
  return result.verification_status === "SUCCESS";
}

async function routeWebhookEvent(event, env) {
  const type = event.event_type;
  const resource = event.resource || {};

  if (type === "PAYMENT.SALE.COMPLETED") {
    // Nur relevant, wenn die Zahlung zu einem Abo gehört (billing_agreement_id
    // ist bei einmaligen Zahlungen über die Orders-API nicht gesetzt).
    const subID = resource.billing_agreement_id;
    if (!subID) return;
    const record = await getSubRecord(env, subID);
    if (record) {
      record.status = "ACTIVE";
      record.lastPaymentAt = resource.create_time || new Date().toISOString();
      await putSubRecord(env, subID, record);
    }
    await sendPaymentSuccessEmail(env, {
      name: record?.name,
      email: record?.email,
      subscriptionId: subID,
      amount: resource.amount?.total || record?.amount,
      currency: resource.amount?.currency || "EUR",
      paymentDate: resource.create_time || new Date().toISOString(),
      transactionId: resource.id,
    });
    return;
  }

  if (type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
    const subID = resource.id;
    const record = await getSubRecord(env, subID);
    if (record) {
      record.status = "PAYMENT_FAILED";
      await putSubRecord(env, subID, record);
    }
    await sendPaymentFailedEmail(env, {
      name: record?.name,
      email: record?.email,
      subscriptionId: subID,
      amount: record?.amount,
      date: new Date().toISOString(),
      status: resource.status || "PAYMENT_FAILED",
      eventId: event.id,
    });
    return;
  }

  if (type === "BILLING.SUBSCRIPTION.CANCELLED") {
    const subID = resource.id;
    const record = await getSubRecord(env, subID);
    if (record && record.status !== "CANCELLED") {
      record.status = "CANCELLED";
      record.cancelledAt = resource.status_update_time || new Date().toISOString();
      await putSubRecord(env, subID, record);
      await sendCancellationEmail(env, {
        name: record.name,
        email: record.email,
        subscriptionId: subID,
        cancelledAt: record.cancelledAt,
        lastPaymentAt: record.lastPaymentAt,
        source: "PayPal (Webhook)",
      });
    }
    return;
  }

  if (type === "BILLING.SUBSCRIPTION.SUSPENDED" || type === "BILLING.SUBSCRIPTION.EXPIRED") {
    const subID = resource.id;
    const record = await getSubRecord(env, subID);
    if (record) {
      record.status = type === "BILLING.SUBSCRIPTION.SUSPENDED" ? "SUSPENDED" : "EXPIRED";
      await putSubRecord(env, subID, record);
    }
    return;
  }

  // Andere Event-Typen (z. B. BILLING.SUBSCRIPTION.CREATED/UPDATED) werden
  // aktuell nicht benötigt und bewusst ignoriert.
}

async function getSubRecord(env, subID) {
  if (!env.ORDERS || !subID) return null;
  const raw = await env.ORDERS.get("subrec:" + subID);
  return raw ? JSON.parse(raw) : null;
}
async function putSubRecord(env, subID, record) {
  if (!env.ORDERS) return;
  await env.ORDERS.put("subrec:" + subID, JSON.stringify(record));
}

/* ============================================================
   ADMIN: INTERNE BUCHUNGSVERWALTUNG
   ------------------------------------------------------------
   Nutzt ausschließlich die bereits vorhandene ORDERS-KV-Bindung.
   Kein neues Framework, keine neue Datenbank.
   ============================================================ */

// Konstante-Zeit-Vergleich, damit der Admin-Token nicht per Timing-Angriff
// erraten werden kann.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkAdminAuth(request, env) {
  if (!env.ADMIN_TOKEN) return false; // ohne gesetztes Secret ist der Admin-Bereich komplett gesperrt
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return timingSafeEqual(token, env.ADMIN_TOKEN);
}

// Wird nach erfolgreicher Zahlung (Einmalzahlung) bzw. nach bestätigtem Abo
// aufgerufen. Legt NUR einen zusätzlichen, persistenten Datensatz für die
// Admin-Ansicht an – die eigentliche Zahlungslogik bleibt unberührt.
async function createPendingBooking(env, { id, type, booking, amount, paypalRef }) {
  if (!env.ORDERS || !id) return;
  const b = booking || {};
  const record = {
    id,
    type, // "einmalig" | "abo"
    status: "pending",
    name: b.name || "",
    email: b.email || "",
    address: b.address || "",
    date: b.date || "",
    bins: b.bins ?? null,
    binTypes: b.binTypes || "",
    abo: !!b.abo,
    extras: b.extras || "",
    note: b.note || "",
    amount: amount || null,
    paypalRef: paypalRef || id,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  await env.ORDERS.put("booking:" + id, JSON.stringify(record));
}

async function listBookings(env, status) {
  if (!env.ORDERS) return [];
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    // Sicherheitslimit gegen Endlosschleifen; für den erwarteten
    // Buchungsumfang einer kleinen lokalen Firma weit ausreichend.
    const page = await env.ORDERS.list({ prefix: "booking:", cursor });
    for (const k of page.keys) {
      const raw = await env.ORDERS.get(k.name);
      if (!raw) continue;
      const rec = JSON.parse(raw);
      if (status === "all" || rec.status === status) out.push(rec);
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  out.sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));
  return out;
}

async function getBooking(env, id) {
  if (!env.ORDERS || !id) return { error: "Ungültige ID" };
  const raw = await env.ORDERS.get("booking:" + id);
  if (!raw) return { error: "Buchung nicht gefunden" };
  return JSON.parse(raw);
}

// Storniert einen bereits angenommenen Termin für die interne Verwaltung.
// Die Buchung bleibt im KV erhalten und es wird keine PayPal-Rückerstattung
// und kein automatischer Versand ausgelöst. Stattdessen wird ein fertiger
// Gmail-Entwurf (an/Betreff/Text) zurückgegeben, den das Admin-Panel öffnet.
function buildAdminCancellationEmail(rec) {
  if (!rec.email) return null;
  const name = rec.name || "";
  const date = formatDateDe(rec.date);
  const text = [
    `Guten Tag ${name},`.trim(),
    ``,
    `leider müssen wir Ihnen mitteilen, dass Ihr bereits bestätigter EcoBin-Reinigungstermin am ${date} nachträglich abgesagt werden muss.`,
    ``,
    `Wir entschuldigen uns für die entstandenen Umstände und bedanken uns für Ihr Verständnis.`,
    ``,
    `Bei Fragen können Sie uns gerne kontaktieren.`,
    ``,
    `Freundliche Grüße`,
    `Ihr EcoBin-Team`,
  ].join("\n");
  return {
    to: rec.email,
    subject: "Ihre EcoBin-Reinigung wurde nachträglich abgesagt",
    text,
  };
}

async function cancelAdminBooking(id, env) {
  if (!env.ORDERS || !id) return { error: "Ungültige ID" };
  const key = "booking:" + id;
  const raw = await env.ORDERS.get(key);
  if (!raw) return { error: "Buchung nicht gefunden" };
  const rec = JSON.parse(raw);
  if (rec.status !== "accepted") {
    return { error: `Termin kann nicht abgesagt werden (Status: ${rec.status})`, status: rec.status };
  }
  rec.status = "cancelled";
  rec.cancelledAt = new Date().toISOString();
  await env.ORDERS.put(key, JSON.stringify(rec));
  return { status: "cancelled", id, booking: rec, email: buildAdminCancellationEmail(rec) };
}

// Setzt den Status einer Buchung EINMALIG von "pending" auf "accepted"/
// "rejected". Verschickt dabei KEINE E-Mail mehr selbst (siehe Hinweis
// oben im Datei-Header) – stattdessen wird ein fertiger E-Mail-Entwurf
// (an/Betreff/Text) zurückgegeben, den das Admin-Panel als Gmail-
// Compose-Fenster öffnet. Der Admin verschickt die Mail dann manuell.
// Der Entwurf nutzt die gespeicherte E-Mail-Vorlage ("booking_accepted"/
// "booking_rejected", siehe buildDecisionEmail), sofern vorhanden, sonst
// den bisherigen fest codierten Text als Fallback.
// Ein zweiter Aufruf (Doppelklick, doppelter Request) verändert nichts
// mehr, weil der Status dann nicht mehr "pending" ist.
async function decideBooking(id, newStatus, env) {
  if (!env.ORDERS || !id) return { error: "Ungültige ID" };
  const key = "booking:" + id;
  const raw = await env.ORDERS.get(key);
  if (!raw) return { error: "Buchung nicht gefunden" };
  const rec = JSON.parse(raw);
  if (rec.status !== "pending") {
    return { error: `Buchung wurde bereits bearbeitet (Status: ${rec.status})`, status: rec.status };
  }
  rec.status = newStatus;
  rec.decidedAt = new Date().toISOString();
  await env.ORDERS.put(key, JSON.stringify(rec));

  const email = await buildDecisionEmail(rec, newStatus, env);
  return { status: newStatus, id, email };
}

function formatDateDe(d) {
  if (!d) return "-";
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString("de-DE");
  } catch (_) {
    return d;
  }
}

// Baut nur noch den E-Mail-INHALT (an/Betreff/Text) für die Bestätigung –
// verschickt wird nichts mehr serverseitig, siehe decideBooking().
function buildAcceptedEmail(rec) {
  if (!rec.email) return null;
  const lines = [
    `Hallo ${rec.name || ""},`.trim(),
    ``,
    `deine EcoBin-Buchung wurde bestätigt.`,
    ``,
    `Termin: ${formatDateDe(rec.date)}`,
    `Tonnen: ${rec.binTypes || "-"}`,
    rec.extras && rec.extras !== "keine" ? `Extras: ${rec.extras}` : null,
    `Art: ${rec.abo ? "Monatsabo" : "Einmalige Reinigung"}`,
    `Preis: ${rec.amount ? String(rec.amount).replace(".", ",") + " €" : "-"}`,
    `Adresse: ${rec.address || "-"}`,
    ``,
    `Wir freuen uns auf den Termin!`,
    `Dein EcoBin-Team`,
  ].filter((l) => l !== null);
  return { to: rec.email, subject: "Ihre EcoBin-Buchung wurde bestätigt", text: lines.join("\n") };
}

// Baut nur noch den E-Mail-INHALT (an/Betreff/Text) für die Ablehnung –
// verschickt wird nichts mehr serverseitig, siehe decideBooking().
function buildRejectedEmail(rec) {
  if (!rec.email) return null;
  const lines = [
    `Hallo ${rec.name || ""},`.trim(),
    ``,
    `leider können wir deine angefragte Buchung (Wunschtermin: ${formatDateDe(
      rec.date
    )}) so nicht bestätigen.`,
    `Bitte melde dich gerne bei uns, damit wir gemeinsam einen passenden Termin finden.`,
    ``,
    `Dein EcoBin-Team`,
  ];
  return { to: rec.email, subject: "Ihre EcoBin-Buchungsanfrage", text: lines.join("\n") };
}

/* ============================================================
   ADMIN: ANDERE NACHRICHTEN AUS GMAIL (NEU)
   ------------------------------------------------------------
   Holt die neuesten Nachrichten aus dem Gmail-Posteingang von
   ecobin.badvilbel@gmail.com über die Gmail-API und filtert dabei
   alle automatischen Benachrichtigungen heraus, die der Worker selbst
   über Resend an sich selbst verschickt (Buchungen, Zahlungen,
   Kündigungen). Übrig bleiben "echte" Nachrichten von Kunden/Dritten.
   ============================================================ */

// Tauscht das langlebige Refresh-Token gegen ein kurzlebiges
// Zugriffstoken für die Gmail-API. Wird bei jedem Admin-Aufruf neu
// geholt (Verwaltungsansicht mit geringem Aufruf-Volumen, daher
// bewusst kein Caching, um die Sache einfach zu halten).
async function getGmailAccessToken(env) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Gmail-Zugangsdaten (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN) sind nicht gesetzt");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Gmail-Zugriffstoken konnte nicht abgerufen werden: " + JSON.stringify(data));
  return data.access_token;
}

// Extrahiert Name/E-Mail aus einem "From"-Header wie
// '"Julia Berg" <julia.berg@example.com>' oder 'julia.berg@example.com'.
function parseFromHeader(from) {
  if (!from) return { name: "", email: "" };
  const match = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  }
  return { name: "", email: from.trim().toLowerCase() };
}

function headerValue(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

// Dekodiert den Base64URL-kodierten Nachrichtentext der Gmail-API.
function decodeBase64Url(data) {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_) {
    return "";
  }
}

// Sucht rekursiv im MIME-Payload nach dem ersten "text/plain"-Teil.
function extractPlainText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  // Fallback: text/html grob von Tags befreien, falls kein Plaintext-Teil da ist.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

async function listOtherMessages(env) {
  const accessToken = await getGmailAccessToken(env);

  // "category:primary" nutzt Gmails eigene Kategorisierung: Newsletter,
  // Werbung, Social-/Update-Benachrichtigungen (z. B. "Sie haben sich bei
  // X angemeldet") landen bei Gmail automatisch in "Updates"/"Promotions"/
  // "Social"/"Forums" und werden dadurch schon serverseitig ausgeblendet.
  // "-from:onboarding@resend.dev" filtert zusätzlich die automatischen
  // Buchungs-/Zahlungs-/Kündigungs-Mails heraus, die der Worker selbst
  // über Resend an dieses Postfach schickt.
  const q = encodeURIComponent(`in:inbox category:primary -from:${AUTOMATED_SENDER}`);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${q}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = await listRes.json();
  const ids = (listData.messages || []).map((m) => m.id);
  if (!ids.length) return [];

  const messages = [];
  for (const id of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msg = await msgRes.json();
    if (!msg || !msg.payload) continue;

    const headers = msg.payload.headers || [];
    const { name, email } = parseFromHeader(headerValue(headers, "From"));

    // Doppelte Absicherung: auch hier nochmal automatische Absender
    // (Anmelde-Benachrichtigungen, Newsletter, System-Mails usw.)
    // herausfiltern, falls die Gmail-Suche mal einen Ausreißer liefert.
    if (isAutomatedSender(email)) continue;

    // Wichtigster Filter für "echte" Kundenmails: Massen-/Newsletter-/
    // Firmen-Mails enthalten (rechtlich vorgeschrieben) fast immer einen
    // "List-Unsubscribe"-Header ("Abmelden"-Link). Persönlich getippte
    // Nachrichten von echten Menschen haben diesen Header nie. Ebenso
    // "Precedence: bulk/list/junk" ist ein klassisches Massen-Mail-Signal.
    if (headerValue(headers, "List-Unsubscribe")) continue;
    const precedence = headerValue(headers, "Precedence").toLowerCase();
    if (precedence === "bulk" || precedence === "list" || precedence === "junk") continue;
    if (headerValue(headers, "List-Id")) continue;
    if (headerValue(headers, "Auto-Submitted") && headerValue(headers, "Auto-Submitted").toLowerCase() !== "no") continue;

    const subject = headerValue(headers, "Subject");
    const body = extractPlainText(msg.payload) || msg.snippet || "";
    const internalDateMs = Number(msg.internalDate || 0);
    const receivedAt = internalDateMs ? new Date(internalDateMs).toISOString().slice(0, 10) : "";

    messages.push({
      id: msg.id,
      name: name || email || "Unbekannt",
      email,
      subject,
      message: body.trim(),
      receivedAt,
    });
  }

  messages.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
  return messages;
}

// Verschiebt eine Nachricht in Gmail in den Papierkorb, damit sie beim
// nächsten Laden nicht mehr unter "Andere Nachrichten" auftaucht.
async function dismissOtherMessage(env, id) {
  if (!id) return { error: "Ungültige ID" };
  const accessToken = await getGmailAccessToken(env);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const details = await res.json().catch(() => null);
    return { error: "Nachricht konnte nicht entfernt werden", details };
  }
  return { ok: true, id };
}

/* ============================================================
   E-MAIL-VERSAND ueber Resend (kostenlos bis 3.000 E-Mails/Monat)

   WICHTIGER HINWEIS: Mit dem Absender "onboarding@resend.dev" (ohne
   eigene verifizierte Domain) lässt Resend im Regelfall NUR Zustellungen
   an die beim Resend-Konto hinterlegte eigene E-Mail-Adresse zu. E-Mails
   an EcoBin (NOTIFY_EMAIL) funktionieren damit zuverlässig. E-Mails
   DIREKT an Kunden (z. B. der Verwaltungslink) können mit diesem
   Test-Absender fehlschlagen, bis eine eigene Domain bei Resend
   verifiziert und FROM_EMAIL entsprechend angepasst wird. Deshalb wird
   der Verwaltungslink zusätzlich immer direkt auf der Website angezeigt
   und in der Buchungs-E-Mail an EcoBin mitgeschickt. Aus demselben Grund
   verschickt decideBooking() (Annehmen/Ablehnen einer Buchung) seit
   Kurzem KEINE E-Mail mehr automatisch über diese Funktion, sondern
   liefert nur noch den fertigen Text an das Admin-Panel zurück (siehe
   buildAcceptedEmail/buildRejectedEmail weiter oben).
   ============================================================ */
async function sendEmail(env, { to, subject, text, replyTo }) {
  if (!env.RESEND_API_KEY || !to) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        reply_to: replyTo || undefined,
        subject,
        text,
      }),
    });
  } catch (err) {
    console.error("E-Mail-Versand fehlgeschlagen:", err.message);
  }
}

async function sendBookingEmail(env, { typ, orderID, amount, booking, manageToken }) {
  const b = booking || {};
  const lines = [
    `Neue EcoBin-Buchung (${typ}) – automatisch nach bestätigter Zahlung verschickt.`,
    ``,
    typ === "Monatsabo" ? `PayPal Subscription ID: ${orderID}` : `PayPal-Referenz: ${orderID}`,
    `Monatsbetrag/Betrag: ${amount} EUR`,
    `Anzahl Tonnen: ${b.bins ?? "-"}`,
    `Ausgewählte Tonnen: ${b.binTypes || "keine Angabe"}`,
    `Abo: ${b.abo ? "Ja" : "Nein"}`,
    `Extras: ${b.extras || "keine"}`,
    `Wunschtermin: ${b.date || "-"}`,
    `Datum/Uhrzeit der Buchung: ${new Date().toLocaleString("de-DE")}`,
    `Name: ${b.name || "-"}`,
    `E-Mail des Kunden: ${b.email || "-"}`,
    `Adresse: ${b.address || "-"}`,
    `Hinweis: ${b.note || "keiner"}`,
  ];
  if (manageToken) {
    lines.push(``, `Verwaltungslink des Kunden (Status/Kündigung, bei Bedarf erneut zusenden):`, buildManageUrl(env, manageToken));
  }
  await sendEmail(env, {
    to: notifyEmail(env),
    subject: `🔔 Neue Buchung – ${typ} (${amount} €)`,
    text: lines.join("\n"),
    replyTo: b.email || undefined,
  });
}

async function sendOneTimePaymentSuccessEmail(env, { name, email, orderID, amount, currency, paymentDate, transactionId }) {
  const text = [
    `Neue PayPal-Zahlung für EcoBin.`,
    ``,
    `Kunde: ${name || "-"}`,
    `E-Mail: ${email || "-"}`,
    `PayPal-Order-ID: ${orderID || "-"}`,
    `Gezahlter Betrag: ${amount || "-"} ${currency || "EUR"}`,
    `Zahlungsdatum: ${paymentDate || new Date().toISOString()}`,
    `Transaktions-ID: ${transactionId || "-"}`,
  ].join("\n");
  await sendEmail(env, {
    to: notifyEmail(env),
    subject: "💳 Neue PayPal-Zahlung",
    text,
    replyTo: email || undefined,
  });
}

async function sendOneTimePaymentFailedEmail(env, { name, email, orderID, amount, status, error }) {
  const text = [
    `Eine PayPal-Zahlung für EcoBin konnte nicht erfolgreich abgeschlossen werden.`,
    ``,
    `Kunde: ${name || "-"}`,
    `E-Mail: ${email || "-"}`,
    `PayPal-Order-ID: ${orderID || "-"}`,
    `Betrag: ${amount || "-"} EUR`,
    `Status: ${status || "-"}`,
    `Fehler: ${error || "-"}`,
    `Zeitpunkt: ${new Date().toISOString()}`,
  ].join("\n");
  await sendEmail(env, {
    to: notifyEmail(env),
    subject: "❌ Zahlungsfehler",
    text,
    replyTo: email || undefined,
  });
}

async function sendPaymentSuccessEmail(env, { name, email, subscriptionId, amount, currency, paymentDate, transactionId }) {
  const text = [
    `Kunde: ${name || "-"}`,
    `E-Mail: ${email || "-"}`,
    `PayPal Subscription ID: ${subscriptionId}`,
    `Gezahlter Betrag: ${amount || "-"} ${currency || "EUR"}`,
    `Zahlungsdatum: ${paymentDate}`,
    `Transaktions-ID: ${transactionId || "-"}`,
  ].join("\n");
  await sendEmail(env, { to: notifyEmail(env), subject: "💳 Monatszahlung erfolgreich", text });
}

async function sendPaymentFailedEmail(env, { name, email, subscriptionId, amount, date, status, eventId }) {
  const text = [
    `Kunde: ${name || "-"}`,
    `E-Mail: ${email || "-"}`,
    `PayPal Subscription ID: ${subscriptionId}`,
    `Betrag: ${amount || "-"} EUR`,
    `Datum: ${date}`,
    `PayPal-Status: ${status}`,
    `Event-ID: ${eventId || "-"}`,
  ].join("\n");
  await sendEmail(env, { to: notifyEmail(env), subject: "⚠️ Monatszahlung fehlgeschlagen", text });
}

async function sendCancellationEmail(env, { name, email, subscriptionId, cancelledAt, lastPaymentAt, source }) {
  const text = [
    `Name: ${name || "-"}`,
    `E-Mail: ${email || "-"}`,
    `PayPal Subscription ID: ${subscriptionId}`,
    `Kündigungsdatum: ${cancelledAt}`,
    `Letzte Zahlung: ${lastPaymentAt || "-"}`,
    `Status: CANCELLED`,
    `Ausgelöst durch: ${source || "-"}`,
  ].join("\n");
  await sendEmail(env, { to: notifyEmail(env), subject: "🔄 Abo gekündigt", text });
}

async function sendCustomerManageLinkEmail(env, { name, email, manageToken, amount }) {
  const url = buildManageUrl(env, manageToken);
  const text = [
    `Hallo ${name || ""},`.trim(),
    ``,
    `dein EcoBin Monatsabo (${amount} € / Monat) ist aktiv.`,
    `Über den folgenden Link kannst du jederzeit deinen Abo-Status einsehen oder das Abo kündigen:`,
    url,
    ``,
    `Bitte bewahre diesen Link gut auf.`,
  ].join("\n");
  await sendEmail(env, { to: email, subject: "Dein EcoBin Monatsabo – Verwaltungslink", text });
}

function buildManageUrl(env, manageToken) {
  const base = env.SITE_URL || "https://ecobin-badvilbel.de";
  return `${base.replace(/\/$/, "")}/?manage=${manageToken}`;
}


/* ============================================================
   AUTOMATISCHE ADMIN-BENACHRICHTIGUNGEN
   ------------------------------------------------------------
   Läuft über einen Cloudflare-Cron-Trigger. Dadurch funktioniert
   die Benachrichtigung auch dann, wenn die Verwaltungsseite
   gerade nicht geöffnet ist.
   ============================================================ */

async function runScheduledNotifications(env) {
  if (!env.ORDERS || !env.RESEND_API_KEY) return;

  await Promise.allSettled([
    notifyNewGmailMessages(env),
    notifyUpcomingAppointments(env),
  ]);
}

async function notifyNewGmailMessages(env) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) return;

  let messages;
  try {
    messages = await listOtherMessages(env);
  } catch (err) {
    console.error("Gmail-Benachrichtigung fehlgeschlagen:", err.message);
    return;
  }

  for (const msg of messages || []) {
    if (!msg?.id) continue;
    const key = "notify:gmail:" + msg.id;
    if (await env.ORDERS.get(key)) continue;

    const text = [
      `Eine neue Nachricht ist im EcoBin-Gmail-Postfach eingegangen.`,
      ``,
      `Von: ${msg.name || "-"} <${msg.email || "-"}>`,
      `Betreff: ${msg.subject || "-"}`,
      `Eingang: ${msg.receivedAt || "-"}`,
      ``,
      `Nachricht:`,
      msg.message || "(kein Nachrichtentext)",
    ].join("\n");

    await sendEmail(env, {
      to: notifyEmail(env),
      subject: "📩 Neue Nachricht",
      text,
      replyTo: msg.email || undefined,
    });

    await env.ORDERS.put(key, "1", { expirationTtl: 60 * 60 * 24 * 90 });
  }
}

async function notifyUpcomingAppointments(env) {
  const bookings = await listBookings(env, "accepted");
  const now = new Date();

  // "Steht bevor" = am Vortag des Reinigungstermins.
  // Die Berechnung erfolgt bewusst in Europe/Berlin, damit die deutsche
  // Datumsangabe nicht durch UTC um einen Tag verrutscht.
  const berlinDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const today = new Date(`${berlinDate}T00:00:00Z`);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);

  for (const booking of bookings) {
    if (!booking?.date || booking.date !== tomorrowKey) continue;

    const key = `notify:appointment:${booking.id}:${booking.date}`;
    if (await env.ORDERS.get(key)) continue;

    const text = [
      `Ein EcoBin-Reinigungstermin steht morgen an.`,
      ``,
      `Kunde: ${booking.name || "-"}`,
      `E-Mail: ${booking.email || "-"}`,
      `Adresse: ${booking.address || "-"}`,
      `Reinigungstermin: ${formatDateDe(booking.date)}`,
      `Tonnen: ${booking.binTypes || booking.bins || "-"}`,
      `Extras: ${booking.extras || "keine"}`,
      `Betrag: ${booking.amount || "-"} EUR`,
      `Buchungs-ID: ${booking.id || "-"}`,
    ].join("\n");

    await sendEmail(env, {
      to: notifyEmail(env),
      subject: "📅 Reinigungstermin steht bevor",
      text,
      replyTo: booking.email || undefined,
    });

    await env.ORDERS.put(key, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  }
}

/* ============================================================
   HILFSFUNKTIONEN
   ============================================================ */
function sanitizeAmount(value, fallback) {
  const n = Number(String(value ?? "").replace(",", "."));
  if (!isFinite(n) || n <= 0 || n > 1000) return fallback;
  return n.toFixed(2);
}

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN } });
}
function handleCors() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
}
