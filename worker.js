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

   KV-Bindung: ORDERS (wie bisher; wird jetzt zusätzlich für dauerhafte
   Abo-Datensätze und Webhook-Idempotenz genutzt)
   ============================================================ */

const ALLOWED_ORIGIN = "*";
const DEFAULT_NOTIFY_EMAIL = "ecobin.badvilbel@gmail.com";
const FROM_EMAIL = "EcoBin <onboarding@resend.dev>"; // Absender ohne eigene Domain-Verifizierung

function paypalApiBase(env) {
  return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
function notifyEmail(env) {
  return env.NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleCors();
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/config" && request.method === "GET") {
        return jsonResponse({
          clientId: env.PAYPAL_CLIENT_ID || null,
          planId: env.PAYPAL_PLAN_ID || null,
          env: env.PAYPAL_ENV === "live" ? "live" : "sandbox",
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

  if (result.status === "COMPLETED" && env.ORDERS) {
    const stored = await env.ORDERS.get(orderID);
    if (stored) {
      const { booking, amount } = JSON.parse(stored);
      const capturedAmount =
        result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || amount;
      await sendBookingEmail(env, {
        typ: "Einmalzahlung",
        orderID,
        amount: capturedAmount,
        booking,
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
   E-MAIL-VERSAND ueber Resend (kostenlos bis 3.000 E-Mails/Monat)

   WICHTIGER HINWEIS: Mit dem Absender "onboarding@resend.dev" (ohne
   eigene verifizierte Domain) lässt Resend im Regelfall NUR Zustellungen
   an die beim Resend-Konto hinterlegte eigene E-Mail-Adresse zu. E-Mails
   an EcoBin (NOTIFY_EMAIL) funktionieren damit zuverlässig. E-Mails
   DIREKT an Kunden (z. B. der Verwaltungslink) können mit diesem
   Test-Absender fehlschlagen, bis eine eigene Domain bei Resend
   verifiziert und FROM_EMAIL entsprechend angepasst wird. Deshalb wird
   der Verwaltungslink zusätzlich immer direkt auf der Website angezeigt
   und in der Buchungs-E-Mail an EcoBin mitgeschickt.
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
    subject: `Neue Buchung – ${typ} (${amount} €)`,
    text: lines.join("\n"),
    replyTo: b.email || undefined,
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
  await sendEmail(env, { to: notifyEmail(env), subject: "EcoBin – Monatszahlung erhalten", text });
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
  await sendEmail(env, { to: notifyEmail(env), subject: "EcoBin – Monatszahlung fehlgeschlagen", text });
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
  await sendEmail(env, { to: notifyEmail(env), subject: "EcoBin – Monatsabo gekündigt", text });
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
  return new Response(null, { headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
