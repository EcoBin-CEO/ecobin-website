/* ============================================================
   EcoBin – PayPal (Einmalzahlung + echtes Monatsabo)
   ------------------------------------------------------------
   - Ohne "Monatsabo": normale Einmalzahlung.
   - Mit "Monatsabo":  echtes Abo – PayPal bucht den angezeigten
     Betrag automatisch JEDEN MONAT ab (inkl. Extras), bis der
     Kunde über seinen persönlichen Verwaltungslink kündigt.

   CLIENT_ID und PLAN_ID werden jetzt vom Worker geladen
   (GET /api/config), damit beim Wechsel zwischen PayPal-Sandbox
   und Live nur die Worker-Umgebungsvariablen geändert werden
   müssen – nicht der Frontend-Code.
   ============================================================ */

(function () {
  const WORKER_URL = "https://ecobin.mikaback777.workers.dev";
  // Fallback-Werte, falls /api/config kurzzeitig nicht erreichbar ist
  // (z. B. Worker startet gerade neu). Sobald /api/config antwortet,
  // werden diese Werte überschrieben.
  let CLIENT_ID = "AU2qqQnyPxHtGqlxyl3NfxVFgw45TIV6fJ2st4uvJnnWpiz7EBX_SAdfWUPjZUeB8J-nYRwwGB9I2A89";
  let PLAN_ID = "P-90T343477J8853541NJYZCPQ";

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
  const modalHeading = modalCard ? modalCard.querySelector("h3") : null;
  if (!modal || !modalCard) return;

  // Nach erfolgreicher Zahlung: Button verstecken (kein Doppelklick mehr
  // möglich) und Überschrift von "Fast geschafft." auf "Fertig." ändern.
  function markPaymentDone() {
    container.style.display = "none";
    if (modalHeading) modalHeading.textContent = "Fertig.";
  }

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

  // Konfiguration (Client-ID / Plan-ID) vom Worker laden – Sandbox/Live
  // wird dort zentral über Umgebungsvariablen gesteuert.
  const configReady = fetch(WORKER_URL + "/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.clientId) CLIENT_ID = cfg.clientId;
      if (cfg.planId) PLAN_ID = cfg.planId;
    })
    .catch(() => {
      // Fallback-Werte oben werden verwendet
    });

  // Zwei SDK-Instanzen: Einmalzahlung + Abo (erst nach Konfig-Ladeversuch)
  configReady.finally(() => {
    loadSdk("?client-id=" + CLIENT_ID + "&currency=EUR", "ppOrders");
    loadSdk("?client-id=" + CLIENT_ID + "&currency=EUR&vault=true&intent=subscription", "ppSubs");
  });
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
    container.style.display = "";
    status.textContent = "";
    if (modalHeading) modalHeading.textContent = "Fast geschafft.";
    modalCard.querySelectorAll(".manage-link-box").forEach((el) => el.remove());
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
          markPaymentDone();
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
      status.textContent = "⚠️ Abo noch nicht eingerichtet: bitte PAYPAL_PLAN_ID im Worker hinterlegen.";
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
          const res = await fetch(WORKER_URL + "/api/subscriptions/" + data.subscriptionID + "/confirm", {
            method: "POST",
          });
          const result = await res.json().catch(() => ({}));
          status.style.color = "#18553a";
          status.textContent =
            "✅ Abo aktiv! Der Betrag wird ab jetzt monatlich abgebucht. Deine Buchung wurde automatisch an uns übermittelt. Abo-Nr.: " +
            data.subscriptionID;
          markPaymentDone();
          if (result.manageToken) showManageLink(result.manageToken);
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

  // Zeigt dem Kunden direkt nach Abo-Abschluss seinen persönlichen,
  // sicheren Verwaltungslink (Status ansehen / kündigen) an.
  function showManageLink(manageToken) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("manage", manageToken);
    const manageUrl = url.toString();

    const box = document.createElement("div");
    box.className = "manage-link-box";
    box.style.cssText =
      "margin-top:14px;padding:12px 14px;background:#f4fbf7;border:1px solid #bddbd2;border-radius:8px;font-size:12px;line-height:1.6";
    box.innerHTML =
      '<b style="display:block;margin-bottom:4px">Dein Verwaltungslink (Status ansehen / Abo kündigen):</b>' +
      '<input type="text" readonly style="width:100%;box-sizing:border-box;padding:7px 8px;font-size:11px;border:1px solid #bddbd2;background:#fff" value="' +
      manageUrl.replace(/"/g, "&quot;") +
      '">' +
      '<button type="button" style="margin-top:8px;padding:7px 12px;font-size:11px;border:1px solid #18553a;background:#fff;color:#18553a;cursor:pointer;border-radius:6px">In Zwischenablage kopieren</button>' +
      '<p style="margin:8px 0 0;color:#75868e">Bitte speichere diesen Link – nur damit kannst du dein Abo später selbst verwalten oder kündigen. Wir haben dir außerdem, falls möglich, eine E-Mail mit diesem Link geschickt.</p>';
    modalCard.appendChild(box);
    box.querySelector("button").addEventListener("click", () => {
      navigator.clipboard?.writeText(manageUrl).then(() => {
        box.querySelector("button").textContent = "Kopiert ✓";
      });
    });
  }
})();
