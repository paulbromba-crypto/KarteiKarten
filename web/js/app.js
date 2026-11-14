// Oberfläche der Web-App. Die Lernlogik liegt getrennt in engine.js,
// Datenmodell/JSON in model.js, Speicherung in store.js.

import { GROUP_SIZE } from './engine.js';
import {
  createCard, createDeck, decodeTransfer, deckFromTransfer, encodeDeck, nextOrder,
  nonEmpty, normalizeDeck, resetDeck, safeFileName, sortedCards, statistics,
} from './model.js';
import { StudySession } from './session.js';
import { Store, browserBackends, EXPORT_REMINDER_DAYS } from './store.js';

const app = document.getElementById('app');
const overlayRoot = document.getElementById('overlay-root');
const toastRoot = document.getElementById('toast-root');
const fileInput = document.getElementById('file-input');

const store = new Store(browserBackends());
let persistStatus = 'unbekannt';
let study = null; // { key, session }
const ui = { flipped: false, enter: '' };

// MARK: - Hilfsfunktionen

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

const phaseColor = (phase) => `var(--p${Math.min(Math.max(phase, 1), 6)})`;
const phaseLabel = (phase) => (phase === 6 ? 'Gelernt' : `Phase ${phase}`);
const pct = (value) => `${Math.round(value)} %`;

const svg = (path, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;
const icon = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  import: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  share: svg('<path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  skip: svg('<path d="M5 5l8 7-8 7z"/><path d="M14 5l7 7-7 7"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>', 'width="18" height="18"'),
};

function toast(message, action) {
  toastRoot.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.addEventListener('click', () => { toastRoot.innerHTML = ''; action.run(); });
    el.append(button);
  }
  toastRoot.append(el);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { if (el.isConnected) el.remove(); }, action ? 10000 : 3000);
}

// MARK: - Dialoge (Callbacks laufen synchron im Tipp-Ereignis – nötig für das Teilen-Menü)

function closeOverlay() { overlayRoot.innerHTML = ''; }

function openOverlay(innerHTML, { onBackdrop = closeOverlay } = {}) {
  overlayRoot.innerHTML = `<div class="overlay" role="dialog" aria-modal="true">${innerHTML}</div>`;
  const overlay = overlayRoot.firstElementChild;
  overlay.addEventListener('click', (event) => { if (event.target === overlay) onBackdrop(); });
  return overlay;
}

function actionSheet({ title, message, items }) {
  const head = title || message
    ? `<div class="action-head">${title ? `<strong>${esc(title)}</strong>` : ''}${message ? esc(message) : ''}</div>` : '';
  const html = `<div class="action-sheet">
    <div class="action-group">${head}${items.map((item, i) => `
      <button class="action-item${item.destructive ? ' destructive' : ''}${item.checked ? ' checked' : ''}" data-index="${i}" ${item.disabled ? 'disabled' : ''}>${esc(item.label)}</button>`).join('')}
    </div>
    <div class="action-group"><button class="action-item cancel" data-index="cancel">Abbrechen</button></div>
  </div>`;
  const overlay = openOverlay(html);
  overlay.querySelectorAll('.action-item').forEach((button) => {
    button.addEventListener('click', () => {
      const index = button.dataset.index;
      closeOverlay();
      if (index !== 'cancel') items[Number(index)].onSelect();
    });
  });
}

function dialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Abbrechen', destructive = false, input = null, onConfirm, single = false }) {
  const html = `<div class="dialog">
    <div class="dialog-body">
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ''}
      ${input ? `<input type="text" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" enterkeyhint="done" autocomplete="off">` : ''}
    </div>
    <div class="dialog-actions">
      ${single ? '' : `<button data-role="cancel">${esc(cancelLabel)}</button>`}
      <button data-role="ok" class="${destructive ? 'destructive' : ''}">${esc(confirmLabel)}</button>
    </div>
  </div>`;
  const overlay = openOverlay(html, { onBackdrop: single ? closeOverlay : () => {} });
  const field = overlay.querySelector('input');
  const ok = overlay.querySelector('[data-role="ok"]');
  const confirm = () => {
    const value = field ? field.value.trim() : null;
    if (field && !value) return;
    closeOverlay();
    if (onConfirm) onConfirm(value);
  };
  if (field) {
    const update = () => { ok.disabled = !field.value.trim(); };
    field.addEventListener('input', update);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
    update();
    setTimeout(() => field.focus(), 50);
  }
  ok.addEventListener('click', confirm);
  overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', closeOverlay);
}

const alertDialog = (title, message) => dialog({ title, message, single: true });

// MARK: - Speichern / Export / Import

function save() {
  store.save();
}

store.onError = () => toast('Achtung: Speichern fehlgeschlagen. Bitte Stapel exportieren.');

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Exportiert Stapel als JSON: Teilen-Menü (→ „In Dateien sichern“), sonst Download. */
function exportDecks(decks) {
  if (decks.length === 0) return;
  const files = decks.map((deck) => new File([encodeDeck(deck)], `${safeFileName(deck.name)}.json`, { type: 'application/json' }));
  const done = () => {
    store.markExported();
    render();
    toast(decks.length === 1 ? 'Stapel exportiert.' : `${decks.length} Stapel exportiert.`);
  };
  const fallback = () => { files.forEach(downloadFile); done(); };

  let canShare = false;
  try { canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files })); } catch { canShare = false; }
  if (!canShare) { fallback(); return; }

  navigator.share({ files, title: decks.length === 1 ? decks[0].name : 'Karteikarten-Sicherung' })
    .then(done)
    .catch((error) => {
      if (error && error.name === 'AbortError') return; // Benutzer hat abgebrochen
      fallback();
    });
}

async function importFiles(fileList) {
  const results = [];
  const errors = [];
  for (const file of fileList) {
    try {
      const transfer = decodeTransfer(await file.text());
      const deck = deckFromTransfer(transfer);
      store.state.decks.push(deck);
      results.push(deck);
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if (results.length) save();
  render();
  if (results.length && !errors.length) {
    alertDialog('Import erfolgreich', results.map((d) => `„${d.name}“ mit ${d.cards.length} Karten wurde angelegt.`).join('\n'));
  } else if (results.length) {
    alertDialog('Import teilweise erfolgreich', `${results.length} Stapel importiert.\n\n${errors.join('\n\n')}`);
  } else {
    alertDialog('Import fehlgeschlagen', errors.join('\n\n'));
  }
}

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length) importFiles(files);
});

// MARK: - Bausteine

function progressBar(percent) {
  return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}" aria-label="Lernfortschritt">
    <div class="progress-head"><span>Lernfortschritt</span><strong>${pct(percent)}</strong></div>
    <div class="bar"><span style="width:${Math.min(Math.max(percent, 0), 100).toFixed(1)}%"></span></div>
  </div>`;
}

function exportBanner() {
  if (!store.needsExportReminder()) return '';
  const days = store.daysSinceExport();
  const text = days === null
    ? `Du hast deine Karten noch nie gesichert. Exportiere sie, damit nichts verloren geht.`
    : `Letzte Sicherung vor ${days} Tagen. Exportiere deine Stapel (empfohlen alle ${EXPORT_REMINDER_DAYS} Tage).`;
  return `<div class="banner" role="alert">
    <div class="grow"><strong>Sicherung empfohlen</strong><br>${esc(text)}</div>
    <button class="big-btn" data-action="backup-all">Sichern</button>
  </div>`;
}

function phaseOverview(stats, deckId) {
  const tiles = [1, 2, 3, 4, 5, 6].map((phase) => {
    const count = stats.countsPerPhase[phase];
    const inner = `<span class="label">${phaseLabel(phase)}</span><span class="count">${count}</span>`;
    const style = `style="--phase-color:${phaseColor(phase)}"`;
    if (phase < 6 && count > 0) {
      return `<button class="phase-tile" ${style} data-action="study" data-deck="${esc(deckId)}" data-phase="${phase}" aria-label="Nur ${phaseLabel(phase)} lernen, ${count} Karten">${inner}</button>`;
    }
    return `<div class="phase-tile" ${style}>${inner}</div>`;
  }).join('');
  return `<div class="phase-grid">${tiles}</div>
    <div class="stat-row"><span>Warteschlange</span><strong data-testid="queue-count">${stats.queueCount}</strong></div>
    <div class="stat-row"><span>Aktive Lerngruppe</span><strong>${stats.activeCount} / ${GROUP_SIZE}</strong></div>`;
}

// MARK: - Ansicht: Stapelliste

function renderDeckList() {
  const decks = [...store.state.decks].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const list = decks.length === 0
    ? `<div class="empty">
        <div class="icon">🗂️</div>
        <h2>Keine Stapel</h2>
        <p>Lege einen neuen Stapel an oder importiere eine JSON-Datei.</p>
        <button class="big-btn" data-action="new-deck">Neuer Stapel</button>
        <button class="big-btn soft" style="margin-top:10px" data-action="import">Stapel importieren</button>
      </div>`
    : `<div class="group">${decks.map((deck) => {
      const stats = statistics(deck);
      return `<button class="row" data-action="go" data-href="#/deck/${encodeURIComponent(deck.id)}">
          <div class="grow">
            <div style="font-weight:600">${esc(deck.name)}</div>
            <div class="small muted" style="display:flex;justify-content:space-between;margin:2px 0 8px">
              <span>${stats.total} Karten</span><span>${pct(stats.progressPercent)} gelernt</span>
            </div>
            <div class="bar" style="height:6px"><span style="width:${stats.progressPercent.toFixed(1)}%"></span></div>
          </div>
          <span class="chevron">${icon.chevron}</span>
        </button>`;
    }).join('')}</div>`;

  const lastExport = store.state.lastExportAt
    ? `Letzte Sicherung: ${new Date(store.state.lastExportAt).toLocaleDateString('de-DE')}.`
    : 'Noch keine Sicherung exportiert.';

  app.innerHTML = `<div class="page">
    <header class="topbar">
      <button class="icon-btn" data-action="import" aria-label="Stapel importieren">${icon.import}</button>
      <div class="title"></div>
      <button class="icon-btn" data-action="new-deck" aria-label="Neuer Stapel">${icon.plus}</button>
    </header>
    <h1 class="large-title">Karteikarten</h1>
    ${exportBanner()}
    ${list}
    ${decks.length ? `<button class="big-btn soft" style="margin-top:16px" data-action="backup-all">${icon.share} Alle Stapel sichern</button>` : ''}
    <p class="footnote">Alle Daten bleiben nur auf diesem Gerät. ${esc(lastExport)}<br>Dauerhafter Speicher: ${esc(persistStatus)}.</p>
  </div>`;
}

// MARK: - Ansicht: Stapel

function renderDeck(deck) {
  const stats = statistics(deck);
  const cards = sortedCards(deck);
  const cardRows = cards.length === 0
    ? '<div class="row muted">Noch keine Karten. Tippe auf „+“, um eine Karte anzulegen.</div>'
    : cards.map((card) => `<button class="row" data-action="edit-card" data-id="${esc(card.id)}">
        <span class="phase-dot" style="--phase-color:${phaseColor(card.phase)}" aria-label="${phaseLabel(card.phase)}">${card.phase === 6 ? '✓' : card.phase}</span>
        <div class="grow">
          <div class="clamp-2">${esc(card.question)}</div>
          <div class="small muted clamp-2">${esc(card.answer)}</div>
          ${card.caseStudy ? '<div class="case-tag">💼 Fallbeispiel</div>' : ''}
        </div>
      </button>`).join('');

  app.innerHTML = `<div class="page">
    <header class="topbar">
      <button class="icon-btn" data-action="go" data-href="#/" aria-label="Zurück">${icon.back} Stapel</button>
      <div class="title"></div>
      <button class="icon-btn" data-action="add-card" aria-label="Neue Karte">${icon.plus}</button>
      <button class="icon-btn" data-action="deck-menu" aria-label="Mehr">${icon.more}</button>
    </header>
    <h1 class="large-title">${esc(deck.name)}</h1>
    ${exportBanner()}
    <div class="card-box">
      ${progressBar(stats.progressPercent)}
      <div class="small muted" style="margin:10px 0 14px">${stats.learned} von ${stats.total} Karten gelernt</div>
      <button class="big-btn" data-action="study" data-deck="${esc(deck.id)}" ${stats.total === stats.learned ? 'disabled' : ''}>${icon.play} Lernen starten</button>
    </div>
    <div class="section-title">Übersicht</div>
    ${phaseOverview(stats, deck.id)}
    <div class="section-footer">Tippe auf eine Phase, um gezielt nur deren Karten zu lernen.</div>
    <div class="section-title">Karten (${cards.length})</div>
    <div class="group">${cardRows}</div>
  </div>`;
}

function deckMenu(deck) {
  const stats = statistics(deck);
  actionSheet({
    title: deck.name,
    items: [
      { label: 'Bestimmte Phase lernen …', onSelect: () => phasePicker(deck, null, (phase) => go(studyHref(deck.id, phase))) },
      { label: 'Neue Karte', onSelect: () => openEditor(deck, null) },
      { label: 'Umbenennen', onSelect: () => renameDeck(deck) },
      { label: 'Als JSON exportieren', onSelect: () => exportDecks([deck]) },
      { label: 'Zurücksetzen', destructive: true, disabled: stats.total === 0, onSelect: () => confirmReset(deck, () => { resetDeck(deck); save(); render(); }) },
      { label: 'Stapel löschen', destructive: true, onSelect: () => confirmDelete(deck) },
    ],
  });
}

function phasePicker(deck, current, onPick) {
  const stats = statistics(deck);
  actionSheet({
    title: 'Phase wählen',
    message: 'Gezielt nur Karten einer Phase lernen.',
    items: [
      { label: 'Alle Phasen (automatisch)', checked: current === null, onSelect: () => onPick(null) },
      ...[1, 2, 3, 4, 5].map((phase) => ({
        label: `Nur Phase ${phase} (${stats.countsPerPhase[phase]})`,
        checked: current === phase,
        disabled: stats.countsPerPhase[phase] === 0 && current !== phase,
        onSelect: () => onPick(phase),
      })),
    ],
  });
}

function confirmReset(deck, run) {
  dialog({
    title: 'Stapel zurücksetzen?',
    message: 'Alle Karten werden auf Phase 1 gesetzt. Der gesamte Lernfortschritt dieses Stapels geht verloren.',
    confirmLabel: 'Zurücksetzen',
    destructive: true,
    onConfirm: run,
  });
}

function confirmDelete(deck) {
  dialog({
    title: 'Stapel löschen?',
    message: `„${deck.name}“ mit ${deck.cards.length} Karten und dem Lernfortschritt wird gelöscht.`,
    confirmLabel: 'Löschen',
    destructive: true,
    onConfirm: () => {
      store.state.decks = store.state.decks.filter((d) => d.id !== deck.id);
      save();
      go('#/');
    },
  });
}

function renameDeck(deck) {
  dialog({
    title: 'Stapel umbenennen',
    input: { value: deck.name, placeholder: 'Name' },
    confirmLabel: 'Sichern',
    onConfirm: (name) => { deck.name = name; save(); render(); },
  });
}

function newDeck() {
  dialog({
    title: 'Neuer Stapel',
    input: { value: '', placeholder: 'Name' },
    confirmLabel: 'Anlegen',
    onConfirm: (name) => {
      const deck = createDeck(name);
      store.state.decks.push(deck);
      save();
      go(`#/deck/${encodeURIComponent(deck.id)}`);
    },
  });
}

// MARK: - Karten-Editor

function openEditor(deck, card) {
  const field = (name, label, value, placeholder, rows = 2) => `
    <textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}">${esc(value || '')}</textarea>`;
  const html = `<div class="sheet">
    <header class="topbar">
      <button class="icon-btn" data-role="cancel">Abbrechen</button>
      <div class="title">${card ? 'Karte bearbeiten' : 'Neue Karte'}</div>
      <button class="icon-btn" data-role="save" style="font-weight:600">Sichern</button>
    </header>
    <form class="sheet-body">
      <label class="field-label">Frage</label>
      <div class="field">${field('question', 'Frage', card?.question, 'z. B. Opportunitätskosten', 2)}</div>
      <label class="field-label">Antwort</label>
      <div class="field">${field('answer', 'Antwort', card?.answer, 'Definition / Erklärung', 4)}</div>
      <label class="field-label">Praxisbeispiel (optional)</label>
      <div class="field">${field('practiceExample', 'Praxisbeispiel', card?.practiceExample, 'Kurzes Beispiel aus der Praxis', 3)}</div>
      <label class="field-label">Fallbeispiel (optional)</label>
      <div class="field">
        ${field('caseStudy', 'Fallbeispiel', card?.caseStudy, 'Kurzer Praxisfall mit Aufgabe', 3)}
        ${field('caseSolution', 'Lösung', card?.caseSolution, 'Lösung zum Fallbeispiel', 3)}
      </div>
      <label class="field-label">Quelle (optional)</label>
      <div class="field">${field('source', 'Quelle', card?.source, 'z. B. Lehrbuch, Seite', 1)}</div>
      ${card ? `<div class="stat-row" style="margin-top:24px"><span>Aktuelle Phase</span><strong>${card.phase === 6 ? '6 (gelernt)' : card.phase}</strong></div>
      <button class="big-btn danger" data-role="delete" style="margin-top:16px;background:var(--surface)">Karte löschen</button>` : ''}
    </form>
  </div>`;
  const overlay = openOverlay(html, { onBackdrop: () => {} });
  const form = overlay.querySelector('form');
  const saveButton = overlay.querySelector('[data-role="save"]');
  const value = (name) => form.elements[name].value;
  const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
  const validate = () => { saveButton.disabled = !(value('question').trim() && value('answer').trim()); };
  form.querySelectorAll('textarea').forEach((ta) => {
    autosize(ta);
    ta.addEventListener('input', () => { autosize(ta); validate(); });
  });
  validate();

  overlay.querySelector('[data-role="cancel"]').addEventListener('click', closeOverlay);
  saveButton.addEventListener('click', () => {
    if (saveButton.disabled) return;
    if (card) {
      card.question = value('question').trim();
      card.answer = value('answer').trim();
      card.practiceExample = nonEmpty(value('practiceExample'));
      card.caseStudy = nonEmpty(value('caseStudy'));
      card.caseSolution = nonEmpty(value('caseSolution'));
      card.source = nonEmpty(value('source'));
    } else {
      deck.cards.push(createCard({
        question: value('question').trim(),
        answer: value('answer').trim(),
        practiceExample: value('practiceExample'),
        caseStudy: value('caseStudy'),
        caseSolution: value('caseSolution'),
        source: value('source'),
        order: nextOrder(deck),
      }));
      normalizeDeck(deck);
    }
    save();
    closeOverlay();
    render();
    toast(card ? 'Karte gesichert.' : 'Karte angelegt.');
  });
  overlay.querySelector('[data-role="delete"]')?.addEventListener('click', () => {
    dialog({
      title: 'Karte löschen?',
      confirmLabel: 'Löschen',
      destructive: true,
      onConfirm: () => {
        deck.cards = deck.cards.filter((c) => c.id !== card.id);
        normalizeDeck(deck);
        save();
        render();
      },
    });
  });
  if (!card) setTimeout(() => form.elements.question.focus(), 300);
}

// MARK: - Ansicht: Lernen

const studyHref = (deckId, phase) => `#/study/${encodeURIComponent(deckId)}${phase ? `/${phase}` : ''}`;

function getSession(deck, phase) {
  const key = `${deck.id}|${phase ?? ''}`;
  if (!study || study.key !== key || study.session.deck !== deck) {
    study = { key, session: new StudySession(deck, store, phase) };
    ui.flipped = false;
    ui.enter = '';
  }
  return study.session;
}

function cardFaces(card) {
  const extras = [
    card.practiceExample ? `<div class="info-box"><span class="box-title">💡 Praxisbeispiel</span>${esc(card.practiceExample)}</div>` : '',
    card.caseStudy ? `<div class="case-box"><span class="box-title">💼 Fallbeispiel</span>${esc(card.caseStudy)}${card.caseSolution ? `
        <button class="solution-btn" data-action="toggle-solution" aria-expanded="false">Lösung anzeigen</button>
        <div class="solution" hidden><span class="box-title">Lösung</span>${esc(card.caseSolution)}</div>` : ''}</div>` : '',
    card.source ? `<div class="source">📖 ${esc(card.source)}</div>` : '',
  ].join('');

  return `<div class="flashcard${ui.flipped ? ' flipped' : ''}" data-testid="flashcard" role="button" tabindex="0"
      aria-label="Karte umdrehen">
    <section class="face front" aria-hidden="${ui.flipped}">
      <div class="face-head"><span class="badge" style="--phase-color:${phaseColor(card.phase)}">${phaseLabel(card.phase)}</span><span class="face-label">Frage</span></div>
      <div class="question"><p>${esc(card.question)}</p></div>
      <div class="tap-hint">👆 Zum Umdrehen tippen</div>
    </section>
    <section class="face back" aria-hidden="${!ui.flipped}">
      <div class="face-head"><span class="face-label">Antwort</span><span class="badge" style="--phase-color:${phaseColor(card.phase)}">${phaseLabel(card.phase)}</span></div>
      <div class="back-question">${esc(card.question)}</div>
      <div class="answer-scroll">
        <p class="answer">${esc(card.answer)}</p>
        ${extras}
      </div>
    </section>
  </div>`;
}

function studyEmpty(session) {
  const stats = session.statistics;
  if (stats.total === 0) {
    return '<div class="empty"><div class="icon">🗂️</div><h2>Keine Karten</h2><p>Lege zuerst Karten in diesem Stapel an.</p></div>';
  }
  if (session.phaseFilter !== null) {
    return `<div class="empty"><div class="icon">✅</div><h2>Phase ${session.phaseFilter} ist leer</h2>
      <p>In dieser Phase gibt es gerade keine Karten.</p>
      <button class="big-btn" data-action="go" data-href="${studyHref(session.deck.id, null)}">Alle Phasen lernen</button></div>`;
  }
  return '<div class="empty"><div class="icon">🎉</div><h2>Alles gelernt!</h2><p>Alle Karten haben Phase 6 erreicht. Über „Zurücksetzen“ kannst du von vorn beginnen.</p></div>';
}

function renderStudy(deck, phase) {
  const session = getSession(deck, phase);
  const stats = session.statistics;
  const card = session.currentCard;
  const title = session.phaseFilter !== null ? `Nur Phase ${session.phaseFilter}` : deck.name;

  app.innerHTML = `<div class="study">
    <header class="topbar">
      <button class="icon-btn" data-action="go" data-href="#/deck/${encodeURIComponent(deck.id)}" aria-label="Zurück">${icon.back}</button>
      <div class="title">${esc(title)}</div>
      <button class="icon-btn" data-action="study-menu" aria-label="Optionen">${icon.filter}</button>
    </header>
    <div class="study-info">
      ${progressBar(stats.progressPercent)}
      <div class="study-meta">
        ${session.learningPhase !== null ? `<span class="badge" style="--phase-color:${phaseColor(session.learningPhase)}">${phaseLabel(session.learningPhase)}</span>` : ''}
        <span data-testid="group-count">Gruppe ${session.groupCount}/${GROUP_SIZE}</span>
        <span class="push">Warteschlange: ${stats.queueCount}</span>
      </div>
    </div>
    <div class="card-stage ${ui.enter}">${card ? cardFaces(card) : studyEmpty(session)}</div>
    <div class="controls">
      <div class="btn-row">
        <button class="big-btn unknown" data-action="unknown" ${card ? '' : 'disabled'}>${icon.x} Kann ich nicht</button>
        <button class="big-btn known" data-action="known" ${card ? '' : 'disabled'}>${icon.check} Kann ich</button>
      </div>
      <div class="btn-row">
        <button class="big-btn soft" data-action="undo" ${session.canUndo ? '' : 'disabled'}>${icon.undo} Rückgängig</button>
        <button class="big-btn soft" data-action="skip" ${session.canSkip ? '' : 'disabled'}>${icon.skip} Überspringen</button>
      </div>
    </div>
  </div>`;
  ui.enter = '';
}

function studyAction(name) {
  if (!study) return;
  const session = study.session;
  const ok = {
    known: () => session.rateKnown(),
    unknown: () => session.rateUnknown(),
    skip: () => session.skip(),
    undo: () => session.undo(),
  }[name]();
  if (!ok) return;
  ui.flipped = false;
  ui.enter = name === 'known' ? 'enter-known' : 'enter-unknown';
  if (navigator.vibrate) navigator.vibrate(8);
  render();
}

function flipCard() {
  const el = app.querySelector('.flashcard');
  if (!el) return;
  ui.flipped = !ui.flipped;
  el.classList.toggle('flipped', ui.flipped);
  el.querySelector('.front').setAttribute('aria-hidden', String(ui.flipped));
  el.querySelector('.back').setAttribute('aria-hidden', String(!ui.flipped));
}

function studyMenu() {
  if (!study) return;
  const session = study.session;
  const deck = session.deck;
  actionSheet({
    title: 'Optionen',
    items: [
      { label: 'Phase wählen …', onSelect: () => phasePicker(deck, session.phaseFilter, (phase) => go(studyHref(deck.id, phase))) },
      { label: 'Zurücksetzen', destructive: true, onSelect: () => confirmReset(deck, () => { session.reset(); ui.flipped = false; render(); }) },
    ],
  });
}

// MARK: - Routing

function go(href) {
  if (location.hash === href) render();
  else location.hash = href;
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'deck' && parts[1]) return { view: 'deck', deckId: parts[1] };
  if (parts[0] === 'study' && parts[1]) {
    const phase = Number.parseInt(parts[2], 10);
    return { view: 'study', deckId: parts[1], phase: phase >= 1 && phase <= 5 ? phase : null };
  }
  return { view: 'list' };
}

function render() {
  const route = parseRoute();
  const deck = route.deckId ? store.deck(route.deckId) : null;
  if (route.view !== 'list' && !deck) {
    if (location.hash !== '#/' && location.hash !== '') { location.replace('#/'); return; }
  }
  if (route.view !== 'study') study = null;
  if (route.view === 'deck') renderDeck(deck);
  else if (route.view === 'study') renderStudy(deck, route.phase);
  else renderDeckList();
}

let lastRouteKey = '';
window.addEventListener('hashchange', () => {
  closeOverlay();
  render();
  const key = location.hash;
  if (key !== lastRouteKey) { window.scrollTo(0, 0); lastRouteKey = key; }
});

// MARK: - Ereignisse

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    if (event.target.closest('.flashcard')) flipCard();
    return;
  }
  const { action } = target.dataset;
  const route = parseRoute();
  const deck = route.deckId ? store.deck(route.deckId) : null;
  switch (action) {
    case 'go': go(target.dataset.href); break;
    case 'import': fileInput.click(); break;
    case 'new-deck': newDeck(); break;
    case 'backup-all': exportDecks(store.state.decks); break;
    case 'study': go(studyHref(target.dataset.deck, target.dataset.phase ? Number(target.dataset.phase) : null)); break;
    case 'add-card': if (deck) openEditor(deck, null); break;
    case 'edit-card': if (deck) openEditor(deck, deck.cards.find((c) => c.id === target.dataset.id) || null); break;
    case 'deck-menu': if (deck) deckMenu(deck); break;
    case 'study-menu': studyMenu(); break;
    case 'known': case 'unknown': case 'skip': case 'undo': studyAction(action); break;
    case 'toggle-solution': {
      const solution = target.nextElementSibling;
      const show = solution.hidden;
      solution.hidden = !show;
      target.textContent = show ? 'Lösung ausblenden' : 'Lösung anzeigen';
      target.setAttribute('aria-expanded', String(show));
      if (show) solution.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    }
    default: break;
  }
});

app.addEventListener('keydown', (event) => {
  if (event.target.classList?.contains('flashcard') && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    flipCard();
  }
});

document.addEventListener('keydown', (event) => {
  if (!study || overlayRoot.firstChild || /input|textarea/i.test(event.target.tagName)) return;
  if (event.key === 'ArrowRight') studyAction('known');
  else if (event.key === 'ArrowLeft') studyAction('unknown');
  else if (event.key === 'ArrowDown') studyAction('skip');
  else if (event.key === 'Backspace' || (event.key === 'z' && (event.metaKey || event.ctrlKey))) studyAction('undo');
  else if (event.key === ' ' && event.target === document.body) { event.preventDefault(); flipCard(); }
});

// MARK: - Start

async function seedIfNeeded() {
  if (store.state.seeded) return;
  if (store.state.decks.length === 0) {
    try {
      const response = await fetch('./data/sample-deck.json');
      const deck = deckFromTransfer(decodeTransfer(await response.text()));
      store.state.decks.push(deck);
    } catch (error) {
      console.warn('Beispielstapel konnte nicht geladen werden', error);
      return;
    }
  }
  store.state.seeded = true;
  save();
}

async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) { persistStatus = 'vom Browser nicht unterstützt'; return; }
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const granted = already || await navigator.storage.persist();
    persistStatus = granted ? 'aktiv' : 'nicht bestätigt (App zum Home-Bildschirm hinzufügen)';
  } catch {
    persistStatus = 'nicht verfügbar';
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Die erste Übernahme durch den Service Worker ist kein Update.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    // Neue Version ist aktiv. Daten liegen in IndexedDB/localStorage und bleiben erhalten.
    store.flush().then(() => toast('Neue Version installiert.', { label: 'Neu laden', run: () => location.reload() }));
  });
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch((error) => console.warn('Service Worker nicht registriert', error));
}

async function start() {
  await store.load();
  await seedIfNeeded();
  lastRouteKey = location.hash;
  render();
  await requestPersistence();
  if (parseRoute().view === 'list') render();
  registerServiceWorker();
}

window.addEventListener('pagehide', () => { store.flush(); });

start().catch((error) => {
  app.innerHTML = `<div class="empty"><h2>Fehler beim Start</h2><p>${esc(error.message)}</p></div>`;
});

// Für Tests im Browser
window.__karteikarten = { store };
