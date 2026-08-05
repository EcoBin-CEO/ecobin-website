/* ============================================================
   EcoBin – PayPal (Einmalzahlung + echtes Monatsabo)  · SANDBOX
   ------------------------------------------------------------
   - Ohne "Monatsabo": normale Einmalzahlung.
   - Mit "Monatsabo":  echtes Abo – PayPal bucht den angezeigten
     Betrag automatisch JEDEN MONAT ab (inkl. Extras).
   Das Abo wird jetzt serverseitig im Worker angelegt, damit
   echte Fehlermeldungen sichtbar sind.

   PLAN_ID unten = die P-... aus /api/setup-plan.
   ============================================================ */

(function () {
  const CLIENT_ID =
    "AU2qqQnyPxHtGqlxyl3NfxVFgw45TIV6fJ2st4uvJnnWpiz7EBX_SAdfWUPjZUeB8J-nYRwwGB9I2A89";
  const WORKER_URL = "https://ecobin.mikaback777.workers.dev";
  const PLAN_ID = "P-90T343477J8853541NJYZCPQ"; // <-- P-... aus /api/setup-plan

  function amountFromText(text) {
    const c = (text || "").replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
    return c || "10.00";
  }

  // Buchungsdetails aus dem Formular einsammeln, damit der Worker sie
  // VOR der Zahlung speichern kann (fälschungssicher).
  const STD_BIN_QTY_FIELD = {
    Biotonne: "binQtyBiotonne",
    "Restmülltonne": "binQtyRestmuelltonne",
    "Gelbe Tonne": "binQtyGelbeTonne",
    Papiertonne: "binQtyPapiertonne",
  };

  function collectBooking() {
    const d = new FormData(form);
    const selected = extras.filter((x) => x.checked).map((x) => x.value).join(", ") || "keine";
    const qtyNormal = Number(d.get("otherBinQtyNormal")) || 0;
    const qtyGross = Number(d.get("otherBinQtyGross")) || 0;
    const qtyContainer = Number(d.get("otherBinQtyContainer")) || 0;
    const otherDescription = (d.get("otherBinDescription") || "").trim();
    const otherParts = [];
    if (qtyNormal) otherParts.push(`${qtyNormal}x Sonstige Tonne`);
    if (qtyGross) otherParts.push(`${qtyGross}x Große Mülltonne (15 €/Stk.)`);
    if (qtyContainer) otherParts.push(`${qtyContainer}x Container (30 €/Stk.)`);
    const otherPart = otherParts.length
      ? [`Andere Tonne: ${otherParts.join(", ")}${otherDescription ? ` – Beschreibung: ${otherDescription}` : ""}`]
      : [];
    const namedBinTypes = d.getAll("binType").filter((t) => t !== "Andere Tonne");
    const namedBinQty = namedBinTypes.map((t) => Math.max(1, Number(d.get(STD_BIN_QTY_FIELD[t])) || 1));
    const namedBinParts = namedBinTypes.map((t, i) => (namedBinQty[i] > 1 ? `${namedBinQty[i]}x ${t}` : t));
    const binTypes = [...namedBinParts, ...otherPart].join(" | ") || "keine Angabe";
    const namedBinCount = namedBinQty.reduce((s, n) => s + n, 0);
    return {
      bins: namedBinCount + qtyNormal + qtyGross + qtyContainer,
      binTypes,
      abo: !!(abo && abo.checked),
      extras: selected,
      date: d.get("date"),
      name: d.get("name"),
      address: d.get("address"),
      note: d.get("note") || "",
      email: d.get("email") || "",
    };
  }

  const modal = document.querySelector("#payment-modal");
  const modalCard = document.querySelector("#payment-modal .modal-card");
  const aboToggle = document.querySelector("#subscription-toggle");
  if (!modal || !modalCard) return;

  // Alte Platzhalter-Zeilen ("Verbindung erforderlich") entfernen
  modalCard.querySelectorAll(".payment-method").forEach((el) => el.remove());
  // Veralteten Hinweistext kürzen, #payment-price aber erhalten
  const introP = modalCard.querySelector("#payment-price")?.closest("p");
  if (introP) {
    const cur = modalCard.querySelector("#payment-price")?.textContent || "";
    introP.innerHTML = 'Deine Buchung: <b id="payment-price">' + cur + "</b>";
  }

  // Button-Container + Statuszeile + Abo-Hinweis
  const container = document.createElement("div");
  container.id = "paypal-button-container";
  container.style.margin = "16px 0 4px";
  const status = document.createElement("div");
  status.id = "paypal-status";
  status.style.cssText = "font-size:13px;line-height:1.5;margin:6px 0 2px;font-weight:600";
  const aboHint = document.createElement("p");
  aboHint.style.cssText = "font-size:11px;color:#75868e;margin:2px 0 0";
  modalCard.appendChild(container);
  modalCard.appendChild(status);
  modalCard.appendChild(aboHint);

  // Zwei SDK-Instanzen: Einmalzahlung + Abo
  loadSdk("?client-id=" + CLIENT_ID + "&currency=EUR", "ppOrders");
  loadSdk("?client-id=" + CLIENT_ID + "&currency=EUR&vault=true&intent=subscription", "ppSubs");
  function loadSdk(query, ns) {
    const s = document.createElement("script");
    s.src = "https://www.paypal.com/sdk/js" + query;
    s.setAttribute("data-namespace", ns);
    document.head.appendChild(s);
  }

  // Buttons erst zeichnen, wenn das Bezahl-Fenster aufgeht
  const mo = new MutationObserver(() => {
    if (!modal.hasAttribute("hidden")) renderForCurrentChoice();
  });
  mo.observe(modal, { attributes: true, attributeFilter: ["hidden"] });

  function renderForCurrentChoice() {
    container.innerHTML = "";
    status.textContent = "";
    if (aboToggle && aboToggle.checked) {
      aboHint.textContent = "Monatsabo: Dieser Betrag wird automatisch jeden Monat abgebucht, bis du kündigst.";
      renderSubscription();
    } else {
      aboHint.textContent = "Einmalige Zahlung – es wird nichts wiederkehrend abgebucht.";
      renderOrder();
    }
  }

  // --- Einmalzahlung ---
  function renderOrder() {
    if (!window.ppOrders) return void setTimeout(renderOrder, 300);
    window.ppOrders
      .Buttons({
        createOrder: async function () {
          const amount = amountFromText(document.querySelector("#payment-price")?.textContent);
          const res = await fetch(WORKER_URL + "/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: amount, description: "EcoBin Mülltonnenreinigung", booking: collectBooking() }),
          });
          return (await res.json()).id;
        },
        onApprove: async function (data) {
          await fetch(WORKER_URL + "/api/orders/" + data.orderID + "/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          status.style.color = "#18553a";
          status.textContent = "✅ Zahlung erfolgreich! Deine Buchung wurde automatisch an uns übermittelt. Wir bestätigen den Termin per E-Mail.";
        },
        onError: function (err) {
          status.style.color = "#c62828";
          status.textContent = "❌ Zahlungsfehler: " + (err && err.message ? err.message : "bitte erneut versuchen");
        },
      })
      .render("#paypal-button-container");
  }

  // --- Echtes Monatsabo (serverseitig angelegt) ---
  function renderSubscription() {
    if (!PLAN_ID || PLAN_ID.indexOf("P-") !== 0) {
      status.style.color = "#c62828";
      status.textContent = "⚠️ Abo noch nicht eingerichtet: bitte PLAN_ID in paypal.js einfügen.";
      return;
    }
    if (!window.ppSubs) return void setTimeout(renderSubscription, 300);
    window.ppSubs
      .Buttons({
        createSubscription: async function () {
          const amount = amountFromText(document.querySelector("#payment-price")?.textContent);
          const res = await fetch(WORKER_URL + "/api/subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan_id: PLAN_ID, amount: amount, booking: collectBooking() }),
          });
          const sub = await res.json();
          if (!sub.id) {
            const msg =
              sub.error ||
              (sub.details && sub.details[0] && sub.details[0].description) ||
              sub.message ||
              JSON.stringify(sub);
            status.style.color = "#c62828";
            status.textContent = "❌ Abo-Fehler: " + msg;
            throw new Error(msg);
          }
          return sub.id;
        },
        onApprove: async function (data) {
          // Serverseitig bestätigen lassen (Worker prüft bei PayPal nach)
          // und erst dann die Buchung automatisch per E-Mail verschicken.
          await fetch(WORKER_URL + "/api/subscriptions/" + data.subscriptionID + "/confirm", {
            method: "POST",
          });
          status.style.color = "#18553a";
          status.textContent =
            "✅ Abo aktiv! Der Betrag wird ab jetzt monatlich abgebucht. Deine Buchung wurde automatisch an uns übermittelt. Abo-Nr.: " +
            data.subscriptionID;
        },
        onError: function (err) {
          if (!status.textContent) {
            status.style.color = "#c62828";
            status.textContent = "❌ Abo-Fehler: " + (err && err.message ? err.message : "bitte erneut versuchen");
          }
        },
      })
      .render("#paypal-button-container");
  }
})();
