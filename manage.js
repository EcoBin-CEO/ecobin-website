/* ============================================================
   EcoBin – Monatsabo selbst verwalten (Status ansehen / kündigen)
   ------------------------------------------------------------
   Wird über einen persönlichen Link mit ?manage=<Token> aufgerufen.
   Der Token wird dem Kunden direkt nach Abschluss des Monatsabos
   angezeigt (siehe paypal.js) und – sofern zustellbar – zusätzlich
   per E-Mail geschickt. Ohne gültigen Token ist weder der Status
   noch eine Kündigung möglich (siehe worker.js).
   ============================================================ */

(function () {
  const WORKER_URL = "https://ecobin.mikaback777.workers.dev";

  function buildModal() {
    const modal = document.createElement("div");
    modal.id = "manage-modal";
    modal.className = "modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="modal-card">' +
      '<button type="button" id="manage-close" style="position:absolute;right:13px;top:7px;border:0;background:none;font-size:30px;color:#092d4b;cursor:pointer">×</button>' +
      '<div id="manage-content"></div>' +
      "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
    modal.querySelector("#manage-close").addEventListener("click", () => (modal.hidden = true));
    return modal;
  }

  function renderInfo(content) {
    content.innerHTML =
      '<p class="eyebrow blue">MONATSABO</p><h3>Abo verwalten</h3>' +
      "<p>Deinen persönlichen Verwaltungslink hast du direkt nach Abschluss deines Monatsabos auf der Website gesehen bzw. per E-Mail erhalten. Über diesen Link kannst du jederzeit deinen Status ansehen oder kündigen.</p>" +
      "<p>Solltest du den Link verloren haben, schreib uns kurz eine E-Mail – wir senden ihn dir gerne erneut zu.</p>";
  }

  function renderLoading(content) {
    content.innerHTML = '<p class="eyebrow blue">MONATSABO</p><h3>Lädt …</h3>';
  }

  function renderError(content, msg) {
    content.innerHTML = '<p class="eyebrow blue">MONATSABO</p><h3>Nicht gefunden</h3><p>' + escapeHtml(msg) + "</p>";
  }

  function statusLabel(status) {
    const map = {
      ACTIVE: "Aktiv",
      APPROVED: "Aktiv",
      CANCELLED: "Gekündigt",
      SUSPENDED: "Pausiert",
      EXPIRED: "Abgelaufen",
      PAYMENT_FAILED: "Zahlung fehlgeschlagen",
    };
    return map[status] || status || "Unbekannt";
  }

  function renderCancelled(content) {
    content.innerHTML =
      '<p class="eyebrow blue">MONATSABO</p><h3>Dein Monatsabo wurde gekündigt.</h3>' +
      "<p>Es werden keine weiteren Abbuchungen mehr stattfinden.</p>";
  }

  function renderStatus(content, token, data) {
    if (data.status === "CANCELLED") {
      renderCancelled(content);
      return;
    }
    const next = data.nextBillingTime ? new Date(data.nextBillingTime).toLocaleDateString("de-DE") : "–";
    const amount = data.amount ? String(data.amount).replace(".", ",") + " €" : "–";
    content.innerHTML =
      '<p class="eyebrow blue">MONATSABO</p><h3>' +
      statusLabel(data.status) +
      "</h3>" +
      '<p style="font-size:14px;line-height:1.8"><b>Nächste Zahlung:</b> ' +
      next +
      "<br><b>Monatsbetrag:</b> " +
      amount +
      "</p>" +
      '<button type="button" id="manage-cancel-btn" class="button dark-button" style="width:100%;justify-content:center">Monatsabo kündigen</button>' +
      '<p id="manage-cancel-error" style="color:#c62828;font-size:12px;margin-top:10px" hidden></p>';
    content.querySelector("#manage-cancel-btn").addEventListener("click", function () {
      handleCancelClick(this, content, token);
    });
  }

  function handleCancelClick(btn, content, token) {
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1";
      btn.textContent = "Wirklich kündigen? Nochmal klicken zum Bestätigen";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Wird gekündigt …";
    fetch(WORKER_URL + "/api/subscriptions/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.status === "CANCELLED") {
          renderCancelled(content);
        } else {
          showCancelError(content, res.error || "Kündigung fehlgeschlagen, bitte versuche es erneut.");
        }
      })
      .catch(() => showCancelError(content, "Kündigung fehlgeschlagen, bitte versuche es erneut."));
  }

  function showCancelError(content, msg) {
    const btn = content.querySelector("#manage-cancel-btn");
    const err = content.querySelector("#manage-cancel-error");
    if (err) {
      err.textContent = msg;
      err.hidden = false;
    }
    if (btn) {
      btn.disabled = false;
      btn.dataset.confirm = "0";
      btn.textContent = "Monatsabo kündigen";
    }
  }

  function openWithToken(modal, content, token) {
    modal.hidden = false;
    renderLoading(content);
    fetch(WORKER_URL + "/api/subscriptions/manage?token=" + encodeURIComponent(token))
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          renderError(content, data.error);
          return;
        }
        renderStatus(content, token, data);
      })
      .catch(() => renderError(content, "Status konnte gerade nicht geladen werden. Bitte versuche es später erneut."));
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const modal = buildModal();
    const content = modal.querySelector("#manage-content");
    const params = new URLSearchParams(location.search);
    const token = params.get("manage");
    if (token) openWithToken(modal, content, token);

    const infoLink = document.querySelector("#manage-info-open");
    if (infoLink) {
      infoLink.addEventListener("click", (e) => {
        e.preventDefault();
        modal.hidden = false;
        renderInfo(content);
      });
    }
  });
})();
