// Oberflächentest im echten Browser (Playwright, Chromium) mit iPhone-Viewport.
// Aufruf: node tests/e2e/ui.e2e.mjs <BASE_URL> <Screenshot-Ordner> [<Ordner der ausgelieferten sw.js>]
// Der dritte Parameter erlaubt den Update-Test (sw.js wird dort verändert).

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_GLOBAL || '/opt/node22/lib/node_modules', 'playwright')); }
const { chromium, devices } = playwright;

const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOTS = process.argv[3] || './screenshots';
const SERVED_DIR = process.argv[4] || null;
mkdirSync(SHOTS, { recursive: true });

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['✔', name]);
    console.log(`✔ ${name}`);
  } catch (error) {
    results.push(['✘', name, error.message]);
    console.log(`✘ ${name}\n   ${error.message.split('\n').slice(0, 6).join('\n   ')}`);
  }
}

const device = devices['iPhone 15'] || devices['iPhone 14'];

async function newContext(browser, colorScheme) {
  const context = await browser.newContext({ ...device, colorScheme, locale: 'de-DE', acceptDownloads: true, serviceWorkers: 'allow' });
  const external = [];
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (!['localhost', '127.0.0.1', new URL(BASE).hostname].includes(url.hostname) && !url.protocol.startsWith('blob') && !url.protocol.startsWith('data')) external.push(req.url());
  });
  context.external = external;
  return context;
}

// Kurz warten, damit Ein-/Ausblend-Animationen abgeschlossen sind.
const shot = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const queueCount = async (page) => Number(await text(page, '[data-testid="queue-count"]'));
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__karteikarten.store.state)));
const currentQuestion = (page) => page.locator('.face.front .question p').innerText();

async function openApp(page) {
  await page.goto(BASE);
  await page.getByText('BWL/VWL Grundbegriffe').first().waitFor();
}

async function waitForServiceWorker(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  }
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Service Worker steuert die Seite');
}

async function runScheme(browser, scheme) {
  const context = await newContext(browser, scheme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const s = scheme === 'dark' ? 'dunkel' : 'hell';

  await step(`[${s}] Start: Beispielstapel ist vorinstalliert`, async () => {
    await openApp(page);
    const st = await state(page);
    assert.equal(st.decks.length, 1);
    assert.equal(st.decks[0].cards.length, 15);
    assert.equal(st.decks[0].cards.filter((c) => c.caseStudy && c.caseSolution).length, 5);
    await shot(page, `${scheme}-01-stapelliste`);
  });

  await step(`[${s}] Stapelübersicht: Phasen, Warteschlange, aktive Gruppe, Fortschritt`, async () => {
    await page.getByText('BWL/VWL Grundbegriffe').first().click();
    await page.getByRole('button', { name: /Lernen starten/ }).waitFor();
    assert.equal(await queueCount(page), 10);
    assert.match(await page.locator('.stat-row').nth(1).innerText(), /5 \/ 5/);
    assert.match(await text(page, '.progress-head'), /0 %/);
    await shot(page, `${scheme}-02-stapel`);
  });

  await step(`[${s}] Lernen: Karte antippen dreht sie um (Flip-Animation)`, async () => {
    await page.getByRole('button', { name: /Lernen starten/ }).click();
    const card = page.locator('[data-testid="flashcard"]');
    await card.waitFor();
    assert.equal(await currentQuestion(page), 'Ökonomisches Prinzip (Minimal- und Maximalprinzip)');
    await shot(page, `${scheme}-03-vorderseite`);
    await card.click({ position: { x: 150, y: 200 } });
    await page.waitForTimeout(250);
    const mid = await card.evaluate((el) => getComputedStyle(el).transform);
    assert.notEqual(mid, 'none', 'Drehung läuft animiert');
    await page.waitForTimeout(500);
    assert.ok(await card.evaluate((el) => el.classList.contains('flipped')));
    assert.ok(await page.locator('.face.back .answer').isVisible());
    await shot(page, `${scheme}-04-rueckseite`);
    await card.click({ position: { x: 150, y: 80 } });
    await page.waitForTimeout(600);
    assert.ok(!(await card.evaluate((el) => el.classList.contains('flipped'))), 'zweites Tippen dreht zurück');
  });

  await step(`[${s}] Überspringen: Karte ans Ende der Gruppe`, async () => {
    const first = await currentQuestion(page);
    await page.getByRole('button', { name: /Überspringen/ }).click();
    assert.notEqual(await currentQuestion(page), first);
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: /Überspringen/ }).click();
    assert.equal(await currentQuestion(page), 'Preiselastizität der Nachfrage');
    assert.ok(await page.getByRole('button', { name: /Rückgängig/ }).isDisabled(), 'Überspringen ist keine Bewertung');
  });

  await step(`[${s}] Fallbeispiel orange mit aufklappbarer Lösung`, async () => {
    await page.locator('[data-testid="flashcard"]').click({ position: { x: 150, y: 200 } });
    await page.waitForTimeout(650);
    const caseBox = page.locator('.face.back .case-box');
    await caseBox.scrollIntoViewIfNeeded();
    assert.ok(await caseBox.isVisible());
    const solution = page.locator('.face.back .solution');
    assert.ok(!(await solution.isVisible()), 'Lösung ist zunächst verborgen');
    await page.getByRole('button', { name: 'Lösung anzeigen' }).click();
    assert.ok(await solution.isVisible(), 'Lösung wird angezeigt');
    assert.ok(await page.locator('.flashcard').evaluate((el) => el.classList.contains('flipped')), 'Karte bleibt umgedreht');
    await solution.scrollIntoViewIfNeeded();
    await shot(page, `${scheme}-05-fallbeispiel-loesung`);
    const infoBg = await page.locator('.face.back .info-box').evaluate((el) => getComputedStyle(el).backgroundColor);
    const caseBg = await caseBox.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.notEqual(infoBg, caseBg);
  });

  await step(`[${s}] „Kann ich“ / „Kann ich nicht“ / mehrstufiges Rückgängig`, async () => {
    const before = await state(page);
    const q1 = await currentQuestion(page);
    await page.getByRole('button', { name: /^Kann ich$/ }).click();
    assert.ok(!(await page.locator('.flashcard').evaluate((el) => el.classList.contains('flipped'))), 'neue Karte zeigt Vorderseite');
    let st = await state(page);
    const card1 = st.decks[0].cards.find((c) => c.question === q1);
    assert.equal(card1.phase, 2);
    assert.equal(card1.status, 'queued');
    assert.match(await text(page, '.study-meta'), /Warteschlange: 10/);

    const q2 = await currentQuestion(page);
    await page.getByRole('button', { name: /Kann ich nicht/ }).click();
    st = await state(page);
    const card2 = st.decks[0].cards.find((c) => c.question === q2);
    assert.equal(card2.phase, 1);
    assert.equal(card2.status, 'active', 'bleibt in der Gruppe');
    assert.notEqual(await currentQuestion(page), q2, 'kommt später in der Runde');

    await page.getByRole('button', { name: /Rückgängig/ }).click();
    assert.equal(await currentQuestion(page), q2);
    await page.getByRole('button', { name: /Rückgängig/ }).click();
    assert.equal(await currentQuestion(page), q1);
    st = await state(page);
    assert.deepEqual(st.decks[0].cards.map((c) => [c.phase, c.status, c.groupPosition]), before.decks[0].cards.map((c) => [c.phase, c.status, c.groupPosition]));
    assert.ok(await page.getByRole('button', { name: /Rückgängig/ }).isDisabled());
  });

  await step(`[${s}] Daten bleiben nach Neuladen erhalten`, async () => {
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: /^Kann ich$/ }).click();
    const before = await state(page);
    await page.reload();
    await page.locator('[data-testid="flashcard"]').waitFor();
    const after = await state(page);
    assert.deepEqual(after.decks[0].cards.map((c) => c.phase), before.decks[0].cards.map((c) => c.phase));
    assert.equal(after.decks[0].cards.filter((c) => c.phase === 2).length, 3);
    await shot(page, `${scheme}-06-nach-neuladen`);
  });

  await step(`[${s}] „Nur Phase 2 lernen“ über die Übersicht`, async () => {
    await page.getByRole('button', { name: 'Zurück' }).click();
    await page.getByRole('button', { name: /Nur Phase 2 lernen/ }).click();
    await page.locator('.topbar .title', { hasText: 'Nur Phase 2' }).waitFor();
    assert.match(await text(page, '[data-testid="group-count"]'), /Gruppe 3\/5/);
    await page.getByRole('button', { name: /Kann ich nicht/ }).click();
    // Rückfall in Phase 1: Karte verlässt die gefilterte Runde (gleiche Entscheidung wie iOS)
    assert.match(await text(page, '[data-testid="group-count"]'), /Gruppe 2\/5/);
    await page.getByRole('button', { name: /Rückgängig/ }).click();
    assert.match(await text(page, '[data-testid="group-count"]'), /Gruppe 3\/5/);
    await page.getByRole('button', { name: 'Optionen' }).click();
    await page.getByRole('button', { name: 'Phase wählen …' }).click();
    await shot(page, `${scheme}-07-phasenauswahl`);
    await page.getByRole('button', { name: 'Alle Phasen (automatisch)' }).click();
    await page.locator('.topbar .title', { hasText: 'BWL/VWL Grundbegriffe' }).waitFor();
  });

  await step(`[${s}] Zurücksetzen mit Nachfrage`, async () => {
    await page.getByRole('button', { name: 'Optionen' }).click();
    await page.getByRole('button', { name: 'Zurücksetzen' }).click();
    await shot(page, `${scheme}-08-zuruecksetzen-dialog`);
    await page.locator('.dialog').getByRole('button', { name: 'Abbrechen' }).click();
    assert.equal((await state(page)).decks[0].cards.filter((c) => c.phase === 2).length, 3, 'Abbrechen ändert nichts');
    await page.getByRole('button', { name: 'Optionen' }).click();
    await page.getByRole('button', { name: 'Zurücksetzen' }).click();
    await page.locator('.dialog').getByRole('button', { name: 'Zurücksetzen' }).click();
    assert.ok((await state(page)).decks[0].cards.every((c) => c.phase === 1));
    assert.ok(await page.getByRole('button', { name: /Rückgängig/ }).isDisabled());
  });

  await step(`[${s}] Karten-Editor: anlegen, bearbeiten, löschen`, async () => {
    await page.getByRole('button', { name: 'Zurück' }).click();
    await page.getByRole('button', { name: 'Neue Karte' }).click();
    const sheet = page.locator('.sheet');
    assert.ok(await sheet.getByRole('button', { name: 'Sichern' }).isDisabled(), 'ohne Frage/Antwort nicht speicherbar');
    await sheet.locator('textarea[name="question"]').fill('Testfrage <b>fett</b>?');
    await sheet.locator('textarea[name="answer"]').fill('Testantwort\nmit Zeilenumbruch');
    await sheet.locator('textarea[name="caseStudy"]').fill('Ein Fall');
    await sheet.locator('textarea[name="caseSolution"]').fill('Die Lösung');
    await shot(page, `${scheme}-09-editor`);
    await sheet.getByRole('button', { name: 'Sichern' }).click();
    let st = await state(page);
    assert.equal(st.decks[0].cards.length, 16);
    const created = st.decks[0].cards.find((c) => c.question.startsWith('Testfrage'));
    assert.equal(created.phase, 1);
    assert.equal(created.practiceExample, null);
    assert.ok(await page.getByText('Testfrage <b>fett</b>?').isVisible(), 'HTML wird als Text angezeigt');

    await page.getByText('Testfrage <b>fett</b>?').click();
    await sheet.locator('textarea[name="question"]').fill('Geänderte Frage');
    await sheet.getByRole('button', { name: 'Sichern' }).click();
    st = await state(page);
    assert.ok(st.decks[0].cards.some((c) => c.question === 'Geänderte Frage'));

    await page.getByText('Geänderte Frage').click();
    await sheet.getByRole('button', { name: 'Karte löschen' }).click();
    await page.locator('.dialog').getByRole('button', { name: 'Löschen' }).click();
    st = await state(page);
    assert.equal(st.decks[0].cards.length, 15);
  });

  let exportedPath = null;
  await step(`[${s}] Export (Download-Fallback) erzeugt gültiges JSON`, async () => {
    await page.getByRole('button', { name: 'Mehr' }).click();
    await shot(page, `${scheme}-10-stapel-menue`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Als JSON exportieren' }).click(),
    ]);
    assert.equal(download.suggestedFilename(), 'BWL-VWL Grundbegriffe.json');
    exportedPath = join(SHOTS, `${scheme}-export.json`);
    await download.saveAs(exportedPath);
    const json = JSON.parse(readFileSync(exportedPath, 'utf8'));
    assert.equal(json.name, 'BWL/VWL Grundbegriffe');
    assert.equal(json.karten.length, 15);
    assert.ok((await state(page)).lastExportAt, 'Exportdatum gespeichert');
  });

  await step(`[${s}] Import: exportierte Datei, iOS-Datei und fehlerhafte Datei`, async () => {
    await page.getByRole('button', { name: 'Zurück' }).click();
    await page.locator('#file-input').setInputFiles(exportedPath);
    await page.locator('.dialog', { hasText: 'Import erfolgreich' }).waitFor();
    await shot(page, `${scheme}-11-import-erfolgreich`);
    await page.locator('.dialog').getByRole('button', { name: 'OK' }).click();
    assert.equal((await state(page)).decks.length, 2);

    const iosFile = join(SHOTS, 'aus-ios.json');
    writeFileSync(iosFile, '{\n  "format" : "karteikarten-stapel",\n  "karten" : [\n    {\n      "antwort" : "A",\n      "frage" : "F",\n      "phase" : 3\n    }\n  ],\n  "name" : "Aus iOS",\n  "version" : 1\n}');
    await page.locator('#file-input').setInputFiles(iosFile);
    await page.locator('.dialog', { hasText: 'Import erfolgreich' }).waitFor();
    await page.locator('.dialog').getByRole('button', { name: 'OK' }).click();
    const st = await state(page);
    assert.equal(st.decks[2].name, 'Aus iOS');
    assert.equal(st.decks[2].cards[0].phase, 3);

    const bad = join(SHOTS, 'kaputt.json');
    writeFileSync(bad, '{ "name": "Kaputt", "karten": [ { "frage": "nur Frage" } ] }');
    await page.locator('#file-input').setInputFiles(bad);
    await page.locator('.dialog', { hasText: 'Import fehlgeschlagen' }).waitFor();
    assert.match(await page.locator('.dialog').innerText(), /Es fehlt das Feld „antwort“/);
    await shot(page, `${scheme}-12-import-fehler`);
    await page.locator('.dialog').getByRole('button', { name: 'OK' }).click();
    assert.equal((await state(page)).decks.length, 3);
  });

  await step(`[${s}] Export über das Teilen-Menü (Web Share API mit Datei)`, async () => {
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = (data) => !!(data && data.files && data.files.length);
      navigator.share = async (data) => {
        window.__shared = await Promise.all(data.files.map(async (f) => ({ name: f.name, type: f.type, text: await f.text() })));
      };
    });
    await page.getByRole('button', { name: /Alle Stapel sichern/ }).click();
    await page.waitForFunction(() => window.__shared !== null);
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.length, 3);
    assert.ok(shared.every((f) => f.type === 'application/json' && f.name.endsWith('.json')));
    assert.equal(JSON.parse(shared[2].text).name, 'Aus iOS');
  });

  await step(`[${s}] Teilen abgebrochen → kein Download, kein Exportdatum`, async () => {
    await page.evaluate(() => {
      window.__karteikarten.store.state.lastExportAt = null;
      navigator.share = async () => { throw new DOMException('abgebrochen', 'AbortError'); };
    });
    let downloaded = false;
    page.once('download', () => { downloaded = true; });
    await page.getByRole('button', { name: /Alle Stapel sichern/ }).click();
    await page.waitForTimeout(400);
    assert.equal(downloaded, false);
    assert.equal((await state(page)).lastExportAt, null);
  });

  await step(`[${s}] Hinweis nach mehr als 14 Tagen ohne Export`, async () => {
    await page.evaluate(() => {
      const st = window.__karteikarten.store;
      st.state.lastExportAt = new Date(Date.now() - 20 * 86400000).toISOString();
      return st.save();
    });
    await page.reload();
    await page.locator('.banner').waitFor();
    assert.match(await page.locator('.banner').innerText(), /vor 20 Tagen/);
    await shot(page, `${scheme}-13-sicherungshinweis`);
  });

  await step(`[${s}] Offline: App startet und funktioniert ohne Netz`, async () => {
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();
    await page.getByText('BWL/VWL Grundbegriffe').first().waitFor();
    await page.getByText('Aus iOS').first().click();
    await page.getByRole('button', { name: /Lernen starten/ }).click();
    await page.locator('[data-testid="flashcard"]').click();
    await page.getByRole('button', { name: /^Kann ich$/ }).click();
    const st = await state(page);
    assert.equal(st.decks[2].cards[0].phase, 4);
    await page.goto(`${BASE}#/`);
    await page.getByText('Karteikarten').first().waitFor();
    await shot(page, `${scheme}-14-offline`);
    await context.setOffline(false);
  });

  await step(`[${s}] Keine Anfragen an fremde Server, keine JS-Fehler`, async () => {
    assert.deepEqual(context.external, []);
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });

  await step(`[${s}] Safe Areas: Buttons unten liegen über dem Home-Balken`, async () => {
    await page.addStyleTag({ content: ':root{--safe-bottom:34px;--safe-top:47px}' });
    await page.getByText('BWL/VWL Grundbegriffe').first().click();
    await page.getByRole('button', { name: /Lernen starten/ }).click();
    const box = await page.getByRole('button', { name: /Rückgängig/ }).boundingBox();
    const vh = page.viewportSize().height;
    assert.ok(box.y + box.height <= vh - 34, `Abstand unten ${vh - box.y - box.height}px`);
    const top = await page.locator('.topbar').boundingBox();
    const backBtn = await page.getByRole('button', { name: 'Zurück' }).boundingBox();
    assert.ok(backBtn.y >= 47, 'Kopfzeile unter der Statusleiste/Notch');
    assert.ok(top.height >= 52 + 47 - 1);
    assert.ok(box.height >= 44, 'Touch-Ziel mindestens 44 pt hoch');
    await shot(page, `${scheme}-15-safe-area`);
  });

  await context.close();
}

async function runUpdateTest(browser) {
  if (!SERVED_DIR) { results.push(['–', 'Update-Test übersprungen (kein Ordner angegeben)']); return; }
  const swPath = join(SERVED_DIR, 'sw.js');
  const original = readFileSync(swPath, 'utf8');
  const context = await newContext(browser, 'light');
  const page = await context.newPage();
  try {
    await step('[Update] Neue Version wird installiert, Daten bleiben erhalten', async () => {
      writeFileSync(swPath, original.replace("'__BUILD__'", "'version-a'"));
      await openApp(page);
      await waitForServiceWorker(page);
      await page.getByText('BWL/VWL Grundbegriffe').first().click();
      await page.getByRole('button', { name: /Lernen starten/ }).click();
      for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: /^Kann ich$/ }).click();
      await page.evaluate(() => window.__karteikarten.store.flush());
      assert.deepEqual(await page.evaluate(() => caches.keys()), ['karteikarten-version-a']);

      writeFileSync(swPath, original.replace("'__BUILD__'", "'version-b'"));
      // Einfache Testserver vergleichen nur sekundengenau (sonst „304 Not Modified“).
      const future = new Date(Date.now() + 60000);
      utimesSync(swPath, future, future);
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
      await page.locator('.toast', { hasText: 'Neue Version installiert' }).waitFor({ timeout: 15000 });
      await shot(page, 'light-16-update-hinweis');
      await page.locator('.toast').getByRole('button', { name: 'Neu laden' }).click();
      await page.locator('[data-testid="flashcard"]').waitFor();
      assert.deepEqual(await page.evaluate(() => caches.keys()), ['karteikarten-version-b'], 'alter Cache gelöscht');
      const st = await state(page);
      assert.equal(st.decks[0].cards.filter((c) => c.phase === 2).length, 4, 'Lernstand nach Update erhalten');
    });
  } finally {
    writeFileSync(swPath, original);
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  await runScheme(browser, 'light');
  await runScheme(browser, 'dark');
  await runUpdateTest(browser);
} finally {
  await browser.close();
}

const failed = results.filter((r) => r[0] === '✘');
console.log(`\n${results.length - failed.length}/${results.length} Schritte erfolgreich`);
process.exit(failed.length ? 1 : 0);
