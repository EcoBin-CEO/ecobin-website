/* ============================================================
   EcoBin – PayPal Backend (Cloudflare Worker)  ·  SANDBOX
   ------------------------------------------------------------
   Kann jetzt:
     1) Einmalzahlung erstellen   -> POST /api/orders
     2) Einmalzahlung erfassen    -> POST /api/orders/<ID>/capture
     3) Abo-Plan EINMALIG anlegen -> GET  /api/setup-plan
     4) Abo anlegen                -> POST /api/subscriptions
     5) Abo bestätigen             -> POST /api/subscriptions/<ID>/confirm

   NEU: Nach bestätigter Zahlung (Capture bzw. Abo-Bestätigung)
   verschickt der Worker die Buchungsdetails automatisch und
   serverseitig per E-Mail. Der Kunde kann daran nichts mehr
   ändern, weil die Daten VOR der Zahlung in Cloudflare KV
   gespeichert wurden und erst NACH der von PayPal bestätigten
   Zahlung wieder ausgelesen und verschickt werden.

   Secrets (unveraendert): PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
   NEUES Secret: RESEND_API_KEY
   NEUE Bindung (KV Namespace): ORDERS
   ============================================================ */

const PAYPAL_API = "https://api-m.sandbox.paypal.com"; // spaeter: api-m.paypal.com
const ALLOWED_ORIGIN = "*";
const NOTIFY_EMAIL = "ecobin.badvilbel@gmail.com";
const FROM_EMAIL = "EcoBin <onboarding@resend.dev>"; // Absender ohne eigene Domain-Verifizierung

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleCors();
    const url = new URL(request.url);
    try {
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
      if (url.pathname === "/api/setup-plan" && request.method === "GET") {
        return jsonResponse(await setupPlan(env));
      }
      return jsonResponse({ error: "Nicht gefunden" }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

async function getAccessToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return (await res.json()).access_token;
}

// ---- Einmalzahlung ----
async function createOrder(body, env) {
  const token = await getAccessToken(env);
  const amount = body.amount || "10.00";
  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "EUR", value: amount }, description: body.description || "EcoBin Mülltonnenreinigung" }],
    }),
  });
  const order = await res.json();

  // Buchungsdetails sicher zwischenspeichern, BEVOR bezahlt wurde.
  // So kann der Kunde sie nach der Zahlung nicht mehr veraendern.
  if (order.id && env.ORDERS) {
    await env.ORDERS.put(order.id, JSON.stringify({ booking: body.booking || {}, amount }), {
      expirationTtl: 60 * 60 * 24, // 24h – danach automatisch geloescht
    });
  }
  return order;
}

async function captureOrder(orderID, env) {
  const token = await getAccessToken(env);
  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const result = await res.json();

  // Nur wenn PayPal die Zahlung SERVERSEITIG als abgeschlossen bestaetigt,
  // wird die zuvor gespeicherte Buchung per E-Mail verschickt.
  if (result.status === "COMPLETED" && env.ORDERS) {
    const stored = await env.ORDERS.get(orderID);
    if (stored) {
      const { booking, amount } = JSON.parse(stored);
      const capturedAmount =
        result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || amount;
      await sendOrderEmail(env, {
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

// ---- Abo-Plan EINMALIG anlegen ----
async function setupPlan(env) {
  const token = await getAccessToken(env);

  const prodRes = await fetch(`${PAYPAL_API}/v1/catalogs/products`, {
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

  const planRes = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
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
          total_cycles: 0,
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
  return { product_id: product.id, plan_id: plan.id, status: plan.status, hinweis: "Kopiere plan_id in paypal.js" };
}

// ---- Abo (Subscription) serverseitig anlegen ----
async function createSubscription(body, env) {
  const token = await getAccessToken(env);
  const amount = body.amount || "9.00";
  const planId = body.plan_id;
  if (!planId) return { error: "plan_id fehlt" };
  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
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

  // Buchungsdetails sicher zwischenspeichern, BEVOR das Abo bestaetigt ist.
  if (sub.id && env.ORDERS) {
    await env.ORDERS.put("sub:" + sub.id, JSON.stringify({ booking: body.booking || {}, amount }), {
      expirationTtl: 60 * 60 * 24,
    });
  }
  return sub;
}

// ---- Abo serverseitig bestaetigen + E-Mail verschicken ----
async function confirmSubscription(subID, env) {
  const token = await getAccessToken(env);
  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sub = await res.json();

  // Nur wenn PayPal das Abo SERVERSEITIG als aktiv bestaetigt,
  // wird die zuvor gespeicherte Buchung per E-Mail verschickt.
  if ((sub.status === "ACTIVE" || sub.status === "APPROVED") && env.ORDERS) {
    const key = "sub:" + subID;
    const stored = await env.ORDERS.get(key);
    if (stored) {
      const { booking, amount } = JSON.parse(stored);
      await sendOrderEmail(env, {
        typ: "Monatsabo",
        orderID: subID,
        amount,
        booking,
      });
      await env.ORDERS.delete(key);
    }
  }
  return { status: sub.status };
}

// ---- E-Mail-Versand ueber Resend (kostenlos bis 3.000 E-Mails/Monat) ----
async function sendOrderEmail(env, { typ, orderID, amount, booking }) {
  if (!env.RESEND_API_KEY) return;
  const b = booking || {};
  const text = [
    `Neue EcoBin-Buchung (${typ}) – automatisch nach bestätigter Zahlung verschickt.`,
    ``,
    `PayPal-Referenz: ${orderID}`,
    `Betrag: ${amount} EUR`,
    `Tonnen: ${b.bins ?? "-"}`,
    `Abo: ${b.abo ? "Ja" : "Nein"}`,
    `Extras: ${b.extras || "keine"}`,
    `Wunschtermin: ${b.date || "-"}`,
    `Name: ${b.name || "-"}`,
    `Adresse: ${b.address || "-"}`,
    `Hinweis: ${b.note || "keiner"}`,
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `Neue Buchung – ${typ} (${amount} €)`,
      text,
    }),
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN } });
}
function handleCors() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
