/**
 * Suggestion + Feedback collector for Quick Files Converter.
 *
 * SETUP (2 minutes, owner's Google account, on phone or PC):
 * 1. sheets.google.com → Blank spreadsheet → name it "AFC Suggestions".
 * 2. Rename "Sheet1" to "Suggestions". Create a second tab named "Feedback".
 *    Row 1 headers — Suggestions: Timestamp | Suggestion | Page URL | -
 *    Row 1 headers — Feedback:    Timestamp | Message | Page URL | Contact (optional)
 * 3. Extensions → Apps Script → delete the sample code → paste this file.
 * 4. At the top, set SHEET_ID to this spreadsheet's ID
 *    (from the URL: docs.google.com/spreadsheets/d/THIS_PART/edit).
 * 5. Deploy → New deployment → type "Web app" →
 *    Execute as: Me · Who has access: Anyone → Deploy → copy the Web app URL.
 * 6. That URL goes into the site as the suggestions endpoint
 *    (and share the sheet as "Anyone with the link can VIEW" so the
 *    daily reader can fetch it without a login).
 *
 * The site POSTs JSON: { type: "suggestion"|"feedback"|"no-result",
 *   text: "...", page: "https://...", contact: "..." (optional) }
 */
const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    const text = String(d.text || '').slice(0, 2000).trim();
    if (!text) return json({ ok: false, error: 'empty' });

    const tab = d.type === 'feedback' ? 'Feedback' : 'Suggestions';
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sh = ss.getSheetByName(tab);
    if (!sh) sh = ss.insertSheet(tab);

    // type, timestamp, text, page url, contact (optional)
    sh.appendRow([
      new Date(),
      d.type || 'suggestion',
      text,
      String(d.page || '').slice(0, 500),
      String(d.contact || '').slice(0, 200),
    ]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err).slice(0, 200) });
  }
}

// Allow the site to check the endpoint is alive (optional).
function doGet() {
  return json({ ok: true, service: 'afc-suggestions' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
