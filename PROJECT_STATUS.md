# PROJECT_STATUS – EcoBin Backend/Admin

Stand: 2026-08-10 (4. Änderung: Termine im Kalender anklickbar)

## Aktueller Funktionsumfang (worker.js)

1. PayPal-Zahlungsabwicklung (Einmalzahlung + Abo), inkl. Webhooks
2. Öffentliche Konfiguration über `GET /api/config` (u. a. Preise)
3. Interne Buchungsverwaltung (KV-Key `booking:<id>`), Status
   `pending` -> `accepted`/`rejected` über `/api/admin/bookings/*`
   (Auth: `Bearer ADMIN_TOKEN`)
4. Preise & Produkte zentral in der KV unter `config:prices`,
   lesbar öffentlich über `/api/config`, änderbar über
   `/api/admin/prices` (Auth: `Bearer ADMIN_TOKEN`)
5. „Andere Nachrichten" aus Gmail über `/api/admin/other-messages`
6. **NEU:** E-Mail-Vorlagensystem (siehe unten)

Wichtiger bestehender Hinweis: Beim Annehmen/Ablehnen einer Buchung
verschickt der Worker **keine** E-Mail automatisch – stattdessen
liefert `decideBooking()` einen fertigen E-Mail-Entwurf zurück, den
das Admin-Panel in Gmail vorausfüllt. Grund: unzuverlässiger Versand
über den Resend-Testabsender `onboarding@resend.dev`. Das betrifft
NICHT den PayPal-Zahlungsablauf – die Zahlung ist zu diesem
Zeitpunkt bereits abgeschlossen. Falls eine Buchung nach bereits
erfolgter Zahlung abgelehnt wird, muss der Admin die Rückerstattung
aktuell manuell über PayPal veranlassen (keine automatische
Rückerstattungslogik im Worker).

## Änderungen in diesem Schritt (E-Mail-Vorlagensystem – Hauptfunktion)

Ziel war ausschließlich die Backend-Hauptfunktion, **keine** Oberfläche.

Neu in `worker.js`:

- Zwei feste Vorlagen: `booking_accepted` und `booking_rejected`,
  jede nur mit `subject` und `body` (Strings).
- Speicherung in der bestehenden KV (`env.ORDERS`-Binding) unter
  dem Key `config:emailTemplates`, als ein JSON-Objekt mit beiden
  Vorlagen – analog zum bestehenden Muster von `config:prices`.
- Neue Funktionen: `getEmailTemplates(env)`, `saveEmailTemplates(env, templates)`,
  `sanitizeEmailTemplates(body)`. Unbekannte Vorlagentypen im
  Request-Body werden beim Speichern ignoriert (nur die zwei
  festen Typen werden übernommen).
- Neue Endpunkte (beide geschützt mit der bestehenden
  Admin-Authentifizierung `checkAdminAuth`, Header
  `Authorization: Bearer <ADMIN_TOKEN>`):
  - `GET /api/admin/email-templates` – lädt beide Vorlagen
    (liefert leere Strings als Default, falls noch nichts
    gespeichert wurde).
  - `PUT /api/admin/email-templates` – speichert beide Vorlagen
    (Body: `{ "booking_accepted": {"subject": "...", "body": "..."}, "booking_rejected": {...} }`).

Bewusst NICHT gemacht (wie beauftragt):

- Keine Verknüpfung mit `decideBooking()` / `buildAcceptedEmail()` /
  `buildRejectedEmail()` – die dort fest im Code stehenden E-Mail-
  Texte werden also aktuell noch NICHT durch die neuen Vorlagen
  ersetzt. Das wäre ein separater, späterer Schritt.
- Keine weiteren Vorlagentypen, keine Platzhalter-Verarbeitung
  (z. B. `{{name}}`), keine Versionierung/History.
- Keine Oberfläche im Admin-Panel (`Admin-Verwaltung.html` /
  `script.js`) für die neuen Endpunkte – nur die Backend-API.

### Kurztest (lokal, gegen Mock-KV, ohne echtes Deployment)

Getestet und bestanden:

- `GET /api/admin/email-templates` ohne bzw. mit falschem Token
  -> `401 Nicht autorisiert`
- `GET` ohne vorherige Speicherung -> beide Vorlagen mit leerem
  `subject`/`body` (Default)
- `PUT` mit gültigem Token speichert beide Vorlagen korrekt und
  gibt sie zurück; ein zusätzlich mitgeschickter, unbekannter
  Vorlagentyp wird ignoriert
- Erneutes `GET` nach dem `PUT` liefert die zuvor gespeicherten
  Werte (Persistenz in der KV funktioniert)
- `PUT` ohne Token -> `401`, und die zuvor gespeicherten Werte
  bleiben unverändert
- Bestehender `GET /api/admin/prices`-Endpunkt funktioniert nach
  der Änderung weiterhin unverändert (keine Regression)

## Änderungen in diesem Schritt (Oberfläche für E-Mail-Vorlagen)

`worker.js` wurde in diesem Schritt NICHT verändert – die API
(`GET`/`PUT /api/admin/email-templates`) existierte bereits.

Neu in `Admin-Verwaltung.html`, Reiter „Einstellungen":

- Neue aufklappbare Kachel „E-Mail-Vorlagen" (nach „Preise &
  Produkte"), im bestehenden Kachel-Design, ohne neues CSS.
- Zwei Blöcke: „Buchung angenommen" und „Buchung abgelehnt",
  jeweils mit Feldern Betreff (Text) und Nachricht (Textarea)
  sowie einem eigenen „Speichern"-Button.
- Laden beim Öffnen von „Einstellungen" über
  `GET /api/admin/email-templates`.
- Speichern über `PUT /api/admin/email-templates`. Wichtig: die
  API speichert immer beide Vorlagen zusammen, daher sendet
  jeder der beiden Speichern-Buttons stets die aktuellen Werte
  BEIDER Blöcke mit – so überschreibt Speichern von „angenommen"
  nicht versehentlich „abgelehnt" (und umgekehrt).
- Persistenz: Werte liegen in der KV (`config:emailTemplates`),
  nicht in localStorage – bleiben also auch nach Neuladen der
  Seite bzw. auf anderen Geräten erhalten.

Bewusst NICHT gemacht (wie beauftragt):

- Keine weiteren Einstellungen/Felder hinzugefügt.
- Keine Verknüpfung mit `decideBooking()` – die generierten
  E-Mail-Entwürfe beim Annehmen/Ablehnen nutzen weiterhin die
  fest codierten Texte, nicht diese Vorlagen (weiterhin offener,
  separater Schritt, siehe unten).

### Kurztest

Da kein Cloudflare-Deployment vorliegt, wurde die Kernlogik
gegen einen Mock der API (In-Memory statt KV) getestet:

- Erstes Laden ohne vorherige Speicherung -> beide Vorlagen leer
- Speichern des Blocks „angenommen" -> Werte korrekt übernommen,
  „abgelehnt" bleibt unverändert leer
- Simuliertes Neuladen -> gespeicherte Werte von „angenommen"
  erscheinen wieder (Persistenz bestätigt)
- Speichern des Blocks „abgelehnt" (mit den zuvor geladenen
  Werten von „angenommen" im Formular) -> „angenommen" wird
  dabei NICHT überschrieben/geleert, „abgelehnt" korrekt
  gespeichert
- Zweites simuliertes Neuladen -> beide Vorlagen weiterhin
  korrekt vorhanden
- HTML/JS wurden zusätzlich auf Syntaxfehler geprüft (JS-Block
  lässt sich fehlerfrei parsen)

Nicht getestet werden konnte: echtes Deployment gegen den
laufenden Cloudflare Worker inkl. echter KV und Admin-Login im
Browser (kein Netzwerkzugriff/Deployment in dieser Umgebung
verfügbar).

## Änderungen in diesem Schritt (Vorlagen mit Buchung annehmen/ablehnen verknüpft – Hauptfunktion)

Ziel: Beim Annehmen/Ablehnen einer Buchung im Postfach wird jetzt die
gespeicherte E-Mail-Vorlage tatsächlich verwendet (bisher wurde sie nur
gespeichert, aber nirgends genutzt). Kein neuer Versandmechanismus –
weiterhin liefert `decideBooking()` nur einen fertigen E-Mail-Entwurf
(an/Betreff/Text) zurück, den das Admin-Panel wie bisher in Gmail
vorausfüllt.

Neu in `worker.js`:

- `fillEmailPlaceholders(text, rec)`: ersetzt in Betreff/Nachricht der
  Vorlage Platzhalter der Form `{{platzhalter}}` durch die bereits
  vorhandenen Kundendaten der Buchung: `{{name}}`, `{{email}}`,
  `{{datum}}`, `{{tonnen}}`, `{{extras}}`, `{{art}}`, `{{preis}}`,
  `{{adresse}}`. Unbekannte Platzhalter bleiben unverändert stehen
  (kein Fehler).
- `buildDecisionEmail(rec, newStatus, env)`: lädt die gespeicherten
  Vorlagen über `getEmailTemplates(env)` und wählt je nach Status
  `booking_accepted` oder `booking_rejected`. Sind für die passende
  Vorlage Betreff UND Nachricht gespeichert (nicht leer), wird daraus
  mit eingesetzten Kundendaten der E-Mail-Entwurf gebaut. Andernfalls
  (keine Vorlage gespeichert, oder KV-Zugriff schlägt fehl) greift wie
  bisher der fest codierte Text aus `buildAcceptedEmail()` /
  `buildRejectedEmail()` als Fallback – unverändert gegenüber vorher.
- `decideBooking()` ruft jetzt `buildDecisionEmail()` statt direkt
  `buildAcceptedEmail()`/`buildRejectedEmail()` auf. Alles andere in
  `decideBooking()` (Statuswechsel `pending` -> `accepted`/`rejected`,
  Schutz gegen doppelte Bearbeitung, KV-Speicherung) ist unverändert.

Neu in `Admin-Verwaltung.html` (Reiter „Einstellungen" -> „E-Mail-
Vorlagen"):

- Kurzer Hinweistext oberhalb der beiden Vorlagen-Blöcke, der die
  verfügbaren Platzhalter auflistet (`{{name}}`, `{{datum}}`,
  `{{tonnen}}`, `{{extras}}`, `{{art}}`, `{{preis}}`, `{{adresse}}`).
  Rein informativ, keine neue Logik – Laden/Speichern der Vorlagen
  funktioniert wie zuvor über die bestehenden Endpunkte.

Bewusst NICHT gemacht (wie beauftragt):

- Kein neuer E-Mail-/Gmail-Versandmechanismus – der bestehende Ablauf
  (Entwurf zurückgeben, Admin-Panel öffnet Gmail-Compose) bleibt exakt
  gleich, nur der Inhalt des Entwurfs kommt jetzt ggf. aus der Vorlage.
- Keine weiteren Platzhalter über die genannten acht hinaus.
- Keine Änderungen an anderen Bereichen (PayPal, „Andere Nachrichten",
  Preise, Auth) – nur `decideBooking()` und die zwei neuen
  Hilfsfunktionen in `worker.js`, plus der Hinweistext in der HTML.

### Kurztest (lokal, gegen Mock-KV, ohne echtes Deployment)

Getestet und bestanden (jeweils inkl. `formatDateDe`, echter
Datenfelder wie Name/Datum/Tonnen/Extras/Art/Preis/Adresse):

- Keine Vorlage gespeichert -> `buildDecisionEmail()` liefert für
  „angenommen" und „abgelehnt" jeweils exakt den bisherigen fest
  codierten Text (Fallback funktioniert wie gefordert)
- Vorlage für beide Status gespeichert -> Betreff und Nachricht kommen
  aus der Vorlage, alle Platzhalter korrekt durch die Kundendaten der
  Buchung ersetzt (u. a. Preis mit Komma-Format, Datum im
  deutschen Format, Abo-Art)
- Nur eine der beiden Vorlagen gespeichert (z. B. nur „angenommen")
  -> „angenommen" nutzt die Vorlage, „abgelehnt" nutzt weiterhin den
  Fallback-Text (kein Vermischen)
- Unbekannter Platzhalter (z. B. `{{unbekannt}}`) bleibt unverändert
  im Text stehen, kein Fehler
- Keine E-Mail-Adresse in der Buchung -> `buildDecisionEmail()` liefert
  `null` (wie zuvor bei `buildAcceptedEmail`/`buildRejectedEmail`)
- End-to-End über `decideBooking()` mit Mock-KV: Status wechselt
  korrekt von `pending` auf `accepted`, der zurückgegebene E-Mail-
  Entwurf nutzt die gespeicherte Vorlage mit eingesetzten
  Kundendaten, der KV-Eintrag wird korrekt aktualisiert, ein zweiter
  Aufruf für dieselbe Buchung wird wie bisher mit Fehlermeldung
  abgewiesen (kein doppeltes Verarbeiten), und eine zweite Buchung
  ohne gespeicherte „abgelehnt"-Vorlage bekommt korrekt den
  Fallback-Text
- `worker.js` und der eingebettete JS-Block von
  `Admin-Verwaltung.html` wurden zusätzlich auf Syntaxfehler geprüft
  (beide parsen fehlerfrei)

Nicht getestet werden konnte: echtes Deployment gegen den laufenden
Cloudflare Worker inkl. echter KV, echtem Gmail-Compose-Aufruf im
Browser und einer echten Buchung im Postfach (kein Netzwerkzugriff/
Deployment in dieser Umgebung verfügbar).

## Änderungen in diesem Schritt (Termine im Kalender anklickbar – Hauptfunktion)

Ziel: Ein Klick auf einen Termin im Kalender öffnet die bereits
vorhandene Buchungs-Detailansicht (bisher nur aus dem Postfach
erreichbar) mit den vorhandenen Buchungsdaten (Name, E-Mail,
Adresse, Reinigungstermin, Tonnen, Extras, Preis, Status). Keine
neue Ansicht wurde gebaut – es wird exakt dieselbe Detailansicht
(`openBookingDetail()` / `#booking-detail-modal`) wiederverwendet,
die bereits im Postfach ("Buchungsanfragen") beim Klick auf eine
Buchungskarte geöffnet wird.

Geänderte Datei: `Admin-Verwaltung.html` (nur diese; `worker.js`
und `script.js` unverändert).

Was geändert wurde:

- `calEventHtml(b, todayI)`: Jeder Termin-Block im Kalender
  (`.cal-event`) bekommt jetzt ein `data-uid`-Attribut mit der
  eindeutigen Buchungs-ID (`b._uid`), analog zum bestehenden
  Muster bei den Postfach-Karten (`.mail-card`).
- `renderCalendar()`: Nach dem Setzen von `gridEl.innerHTML` wird
  für jeden `.cal-event[data-uid]` ein Klick-Listener registriert,
  der `openBookingDetail(uid)` aufruft – dieselbe Funktion, die
  auch im Postfach genutzt wird. Keine neue Funktion, keine neue
  Modal-Logik.
- CSS: `.cal-event` bekommt `cursor:pointer` sowie einen dezenten
  Hover-Effekt (analog zu `.mail-card:hover`), damit erkennbar
  ist, dass die Termine klickbar sind. Keine Layout-Änderung.

Bewusst NICHT gemacht (wie beauftragt):

- Keine neue/eigene Detailansicht für den Kalender gebaut – es
  wird ausschließlich die bereits vorhandene Buchungs-Detailansicht
  (Postfach-Modal) wiederverwendet.
- Keine Änderungen an `worker.js` oder `script.js`.
- Keine Änderungen an anderen Bereichen der Admin-Oberfläche
  (Dashboard, Postfach, Abos, Kunden, Einstellungen/E-Mail-
  Vorlagen, PayPal-Ablauf) – nur Kalender-Rendering um Klickbarkeit
  ergänzt.
- Kein Filtern/Ändern der bisher im Kalender angezeigten Termine
  (weiterhin alle Buchungen außer Status `rejected`, wie zuvor).

### Kurztest

Da kein Cloudflare-Deployment und kein Browser/DOM (jsdom) in
dieser Umgebung verfügbar ist, wurde geprüft:

- `node --check` auf den extrahierten Inline-JS-Block der HTML-
  Datei -> keine Syntaxfehler.
- Diff gegen die vorherige Version zeigt ausschließlich die vier
  beabsichtigten Änderungen (zwei CSS-Zeilen, `data-uid`-Attribut
  in `calEventHtml`, Klick-Listener-Registrierung in
  `renderCalendar`) – keine ungewollten Nebenänderungen.
- `worker.js` und `script.js` sind byte-identisch zur vorherigen
  Version (Diff leer).
- Code-Review der Datenflusskette bestätigt: `bookings[i]._uid`
  wird beim Laden (`loadDashboard()`) vor jedem `render()`/
  `renderCalendar()`-Aufruf gesetzt; `findBookingByUid()` in
  `openBookingDetail()` sucht exakt darüber – identisches Muster
  wie bei den bereits funktionierenden Postfach-Karten, daher
  funktional konsistent.
- `bdFieldsHtml()` (verwendet von `openBookingDetail()`) liefert
  bereits alle geforderten Felder: Name, E-Mail, Adresse,
  Reinigungstermin, Tonnen (inkl. Tonnenart und Anzahl), Extras,
  Gesamtpreis und Status – unverändert, da die vorhandene
  Detailansicht wiederverwendet wird.

Nicht getestet werden konnte: echter Klick-Test im Browser gegen
den laufenden Cloudflare Worker mit echten Buchungsdaten im
Kalender (kein Netzwerkzugriff/Deployment in dieser Umgebung
verfügbar).

## Offene nächste Schritte (nicht Teil dieses Schritts)

- Keine offenen Schritte zur Kalender-Klickbarkeit mehr bekannt.
  Mögliche spätere Erweiterungen (nicht beauftragt): mehrere
  Termine am selben Tag direkt im Kalender vorsortieren/gruppieren,
  Tages-Detailansicht bei vielen Terminen pro Zelle, Drag&Drop von
  Terminen im Kalender.

## Schritt 2 – Termin nachträglich absagen: Oberfläche + Bestätigung

**Datum:** 2026-08-10

### Geänderte Dateien
- `Admin-Verwaltung.html`

### Umgesetzt
- In der Buchungsdetailansicht gibt es für bereits angenommene (`accepted`) Termine jetzt einen großen roten Button **„Termin nachträglich absagen“**.
- Der Button öffnet einen Bestätigungsdialog mit **„Abbrechen“** und **„Ja, Termin absagen“**.
- In diesem Schritt wird noch keine Buchung geändert, gelöscht oder abgesagt. Die tatsächliche Absage/API folgt erst im nächsten Schritt.

### Tests
- HTML/JavaScript-Struktur geprüft.
- Keine bestehende Buchungs-, PayPal- oder E-Mail-Logik geändert.

### Bekannte Punkte
- Die Bestätigungs-Schaltfläche führt in diesem Schritt bewusst noch keine echte Absage aus.

### Nächster Schritt
- Echte Terminabsage über die bestehende Admin-/KV-Struktur implementieren.


---

## Schritt 3 – Termin nachträglich absagen

Stand: 2026-08-10

### Geändert
- `worker.js`
  - Neue geschützte Admin-Route `POST /api/admin/bookings/<ID>/cancel`.
  - Neue Funktion `cancelAdminBooking(id, env)`.
  - Nur Buchungen mit Status `accepted` können abgesagt werden.
  - Bei erfolgreicher Absage wird der Status auf `cancelled` gesetzt und `cancelledAt` gespeichert.
  - Die Buchung bleibt im KV erhalten.
  - Keine PayPal-Rückerstattung und kein E-Mail-Versand in diesem Schritt.
- `Admin-Verwaltung.html`
  - Bestätigungsdialog aus Schritt 2 führt jetzt die echte Absage über die neue API aus.
  - Nach erfolgreicher Absage wird der lokale Buchungsstatus auf `cancelled` gesetzt und die Ansicht neu gerendert.
  - Abgesagte Termine werden nicht mehr im normalen Kalender angezeigt.
  - Kommende Termine auf dem Dashboard berücksichtigen abgesagte Termine ebenfalls nicht mehr.
  - Statusanzeige ergänzt: `Abgesagt`.

### Tests
- `node --check worker.js` erfolgreich.
- `node --check script.js` erfolgreich.
- Inline-JavaScript von `Admin-Verwaltung.html` erfolgreich mit `node --check` geprüft.
- Codepfade geprüft: Authentifizierung, KV-Lesen/Schreiben, Statusprüfung und Kalenderfilter.

### Bewusst nicht umgesetzt
- Keine PayPal-Rückerstattung.
- Kein automatischer oder Gmail-E-Mail-Entwurf bei der Absage.
- Keine Löschung der Buchung aus dem KV.

### Nächster Schritt
- Nach erfolgreicher Absage einen Gmail-Entwurf für die nachträgliche Absage öffnen.


## Schritt 4 – Nachträgliche Terminabsage mit Gmail-Entwurf
**Datum:** 2026-08-10

### Geändert
- `worker.js`
  - `cancelAdminBooking()` gibt nach erfolgreicher Absage jetzt zusätzlich einen fertigen E-Mail-Entwurf (`to`, `subject`, `text`) zurück.
  - Neue Funktion `buildAdminCancellationEmail()` für die nachträgliche Absage.
  - Kein automatischer E-Mail-Versand und keine PayPal-Rückerstattung.
- `Admin-Verwaltung.html`
  - Nach erfolgreicher Terminabsage wird der bestehende Gmail-Compose-Mechanismus geöffnet.
  - Das Gmail-Tab wird bereits beim Klick geöffnet, damit Popup-Blocker möglichst vermieden werden.
- `scriptblock0.js`
  - Gleiche Absage-/Gmail-Logik wie im Admin-Panel-Quellstand.

### E-Mail
**Betreff:** Ihre EcoBin-Reinigung wurde nachträglich abgesagt

Der Nachrichtentext wird serverseitig mit Kundenname und Termin erzeugt.

### Verhalten
1. Termin öffnen.
2. „Termin nachträglich absagen“ klicken.
3. Absage bestätigen.
4. Worker setzt den Termin auf `cancelled`.
5. Ein vorausgefüllter Gmail-Entwurf wird geöffnet.
6. Die Mail wird nicht automatisch versendet; der Admin muss sie in Gmail selbst absenden.

### Tests
- Syntaxprüfung von `worker.js`: erfolgreich.
- JavaScript-Syntaxprüfung der geänderten Admin-Skripte: erfolgreich.
- Codepfad für Gmail-Compose und Cancel-Response geprüft.

### Noch nicht getestet
- Echter Cloudflare-Worker/KV-Lauf.
- Echter Browser-/Gmail-Login und tatsächliches Öffnen von Gmail in der Zielumgebung.

### Nächster Schritt
- Live-/Sandbox-Test mit einer Testbuchung.


## Automatische Admin-Benachrichtigungen – 2026-08-11

Der Worker sendet automatische Benachrichtigungen an `mikaback777@gmail.com` (sofern
`NOTIFY_EMAIL` nicht auf eine andere Adresse gesetzt ist):

- 🔔 Neue Buchung
- 💳 Neue PayPal-Zahlung
- ❌ Zahlungsfehler
- 💳 Monatszahlung erfolgreich
- ⚠️ Monatszahlung fehlgeschlagen
- 🔄 Abo gekündigt
- 📩 Neue Nachricht
- 📅 Reinigungstermin steht bevor

Die Nachrichten 1–5 werden ereignisbasiert verarbeitet. Für "Neue Nachricht" und
"Reinigungstermin steht bevor" benötigt der Worker zusätzlich einen Cloudflare
Cron-Trigger, da diese Ereignisse auch erkannt werden müssen, wenn die
Verwaltungsseite nicht geöffnet ist. Die Erinnerung an einen Reinigungstermin
wird am Vortag versendet.

Für die Gmail-Benachrichtigung müssen die bereits vorgesehenen Secrets
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` und `GMAIL_REFRESH_TOKEN` vorhanden sein.


## Rabattcode-Fix (2026-08-12)
- Öffentliche Rabattcode-Prüfung über `GET /api/discount-codes/validate?code=...` ergänzt.
- Admin-Verwaltung für Rabattcodes mit Hinzufügen, Bearbeiten und Löschen ergänzt.
- Rabattcodes werden im KV unter `config:discountCodes` gespeichert.
- Website zeigt nach „Anwenden“ direkt z. B. `✓ 15% Rabatt` an.
- Der angezeigte Gesamtpreis wird sofort um den Rabatt reduziert.
- Genau ein Rabattcode pro Buchung; Eingaben werden normalisiert (Leerzeichen entfernt, Großschreibung).
- PayPal-Einmalzahlung und Monatsabo übergeben den angewendeten Rabattcode und den Grundpreis an den Worker.
- Worker prüft den Code beim Erstellen der Zahlung erneut und berechnet den endgültigen Zahlungsbetrag serverseitig.
- `worker.js` ist in Website- und Admin-ZIP identisch.
- Geprüft: JavaScript-Syntax von Worker, Admin-Script, Website-Script und PayPal-Script mit `node --check`.
