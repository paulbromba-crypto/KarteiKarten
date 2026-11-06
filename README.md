# Karteikarten – Lern-App mit Phasensystem

Eine native iOS-App (Swift, SwiftUI, SwiftData) zum Lernen mit Karteikarten nach einem
Phasensystem ähnlich der Leitner-Methode. Die App läuft komplett lokal auf dem iPhone –
ohne Server, ohne Konto, ohne Internet.

- Mindestversion: **iOS 17**
- Keine externen Abhängigkeiten, keine Netzwerkzugriffe
- Fortschritt wird nach jeder Aktion automatisch gespeichert

---

## Inhalt

1. [Funktionen](#funktionen)
2. [So funktioniert das Lernen](#so-funktioniert-das-lernen)
3. [Installation auf dem eigenen iPhone](#installation-auf-dem-eigenen-iphone)
4. [JSON-Format für Import und Export](#json-format-für-import-und-export)
5. [Neue Stapel mit Claude erstellen](#neue-stapel-mit-claude-erstellen)
6. [Projektaufbau](#projektaufbau)

---

## Funktionen

- **Stapel**: anlegen, umbenennen, löschen, als JSON importieren/exportieren
- **Karten**: Frage, Antwort, optional Praxisbeispiel, Fallbeispiel mit Lösung und Quellenangabe – anlegen, bearbeiten, löschen
- **Lernen**: Karte antippen → umdrehen (Flip-Animation)
  - **Kann ich** / **Kann ich nicht** (große Buttons unten, bequem mit dem Daumen)
  - **Überspringen** – Karte ans Ende der Lerngruppe
  - **Rückgängig** – nimmt die letzte Bewertung inklusive Phase vollständig zurück (mehrstufig)
  - **Zurücksetzen** – alle Karten des Stapels auf Phase 1 (mit Sicherheitsabfrage)
- **Phasenauswahl**: gezielt nur Karten einer Phase lernen (Phase in der Übersicht antippen oder Menü oben rechts)
- **Übersicht**: Anzahl Karten in Phase 1–6, in der Warteschlange und in der aktiven Gruppe
- **Lernfortschritt**: (Karten in Phase 6 ÷ alle Karten) × 100 als Fortschrittsbalken
- **Beispielstapel** „BWL/VWL Grundbegriffe“ (15 Karten, 5 davon mit Fallbeispiel) wird beim ersten Start angelegt
- Dark Mode wird automatisch unterstützt

## So funktioniert das Lernen

| Regel | Verhalten |
|---|---|
| Start | Neue Karten beginnen in **Phase 1**. |
| „Kann ich“ | Phase **+1**, die Karte verlässt die Lerngruppe, die nächste Karte rückt nach. |
| „Kann ich nicht“ | Phase **−1** (mindestens 1). Die Karte bleibt in der Gruppe und kommt später in derselben Runde wieder. |
| Phase 6 | = **gelernt**, wird nicht mehr abgefragt. |
| Lerngruppe | Maximal **5 Karten** gleichzeitig aktiv. |
| Reihenfolge | Es wird immer die **niedrigste** noch offene Phase gelernt. Phase 2 beginnt erst, wenn **alle** Karten mindestens Phase 2 erreicht haben. Die Gruppe wird nur aus Karten dieser Phase gefüllt (in Erstellungsreihenfolge). |
| Rückfall | Fällt eine Karte in eine niedrigere Phase zurück, hat diese Phase **sofort** wieder Vorrang. |

Bei der **Phasenauswahl** („Nur Phase 3“) werden ausschließlich Karten dieser Phase abgefragt.
Fällt dabei eine Karte in Phase 2 zurück, verlässt sie die gefilterte Runde und wird beim
normalen Lernen wieder mit Vorrang abgefragt.

Die komplette Logik steckt in `KarteiKarten/Logic/LearningEngine.swift` und ist durch
Unit-Tests in `KarteiKartenTests/LearningEngineTests.swift` abgesichert.

---

## Installation auf dem eigenen iPhone

Du brauchst: einen **Mac** mit **Xcode** (kostenlos im Mac App Store), ein **USB-Kabel**
und deine **Apple-ID** (die normale, kostenlose reicht).

### 1. Projekt herunterladen
1. Öffne das Repository auf GitHub, klicke auf den grünen Button **Code** → **Download ZIP**
   (vorher oben links den Branch `claude/ios-flashcard-leitner-app-8hbkmf` auswählen, falls er noch nicht in `main` übernommen wurde).
2. Entpacke die ZIP-Datei, z. B. in deinen Ordner *Dokumente*.

### 2. Projekt in Xcode öffnen
1. Doppelklicke im entpackten Ordner auf **`KarteiKarten.xcodeproj`**. Xcode öffnet sich.
2. Falls Xcode fragt, ob du dem Projekt vertraust: **Trust and Open** / **Vertrauen und öffnen**.

### 3. Apple-ID in Xcode anmelden (einmalig)
1. Menü **Xcode → Settings…** (bzw. *Einstellungen…*) → Reiter **Accounts**.
2. Unten links auf **+** → **Apple ID** → mit deiner Apple-ID anmelden.

### 4. Signierung einstellen
1. Links im Projektnavigator ganz oben auf das blaue **KarteiKarten**-Symbol klicken.
2. In der Mitte unter **TARGETS** das Target **KarteiKarten** wählen → Reiter **Signing & Capabilities**.
3. Haken bei **Automatically manage signing** setzen (ist bereits voreingestellt).
4. Bei **Team** deinen Namen mit dem Zusatz **(Personal Team)** auswählen.
5. Bei **Bundle Identifier** steht `de.meinname.karteikarten`. Ändere ihn in etwas Eindeutiges,
   z. B. `de.deinvorname.deinnachname.karteikarten` (nur Buchstaben, Ziffern, Punkte, Bindestriche).
   Erscheint eine rote Fehlermeldung, ist der Name schon vergeben – einfach etwas anderes wählen.

### 5. iPhone vorbereiten
1. iPhone per Kabel mit dem Mac verbinden, entsperren und bei der Frage **„Diesem Computer vertrauen?“** auf **Vertrauen** tippen.
2. **Entwicklermodus** einschalten (ab iOS 16 nötig):
   iPhone → **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus** → einschalten → iPhone startet neu → nach dem Neustart **Einschalten** bestätigen.
   *(Taucht der Punkt nicht auf, erst Schritt 6 einmal ausführen – danach erscheint er.)*

### 6. App installieren
1. In Xcode oben in der Mitte (neben dem ▶︎-Button) auf das Geräte-Menü klicken und **dein iPhone** auswählen.
2. Auf **▶︎ (Run)** klicken oder **⌘R** drücken. Beim ersten Mal dauert das 1–2 Minuten.
3. Fragt der Mac nach dem Schlüsselbund-Passwort: dein Mac-Anmeldepasswort eingeben und **Immer erlauben** wählen.

### 7. Entwickler auf dem iPhone vertrauen (einmalig)
Beim ersten Start meldet das iPhone **„Nicht vertrauenswürdiger Entwickler“**:
1. iPhone → **Einstellungen → Allgemein → VPN und Geräteverwaltung**.
2. Unter **Entwickler-App** deine Apple-ID antippen → **„… vertrauen“** → bestätigen.
3. App „Karteikarten“ auf dem Homescreen starten. Fertig!

### Wichtig bei kostenloser Apple-ID
- Die App ist **7 Tage** gültig. Danach startet sie nicht mehr – einfach iPhone anschließen und in Xcode erneut **▶︎** drücken.
  **Deine Karten und dein Lernfortschritt bleiben dabei erhalten**, solange du die App nicht löschst.
- Tipp: Exportiere ab und zu deine Stapel als JSON (Menü „…“ im Stapel → *Als JSON exportieren*) als Sicherung.

### Tests ausführen (optional)
In Xcode **⌘U** drücken (oder Menü **Product → Test**). Wähle dafür oben einen iPhone-Simulator als Ziel.

---

## JSON-Format für Import und Export

Ein Stapel ist eine `.json`-Datei mit diesem Aufbau:

```json
{
  "name": "Name des Stapels",
  "karten": [
    {
      "frage": "Begriff oder Frage (Pflicht)",
      "antwort": "Definition / Antwort (Pflicht)",
      "praxisbeispiel": "Kurzes Beispiel aus der Praxis (optional)",
      "fallbeispiel": "Kurzer Praxisfall mit Aufgabe (optional)",
      "loesung": "Lösung zum Fallbeispiel (optional)",
      "quelle": "Quellenangabe (optional)",
      "phase": 1
    }
  ]
}
```

| Feld | Pflicht? | Bedeutung |
|---|---|---|
| `name` | ja | Name des Stapels |
| `karten` | ja | Liste der Karten (mindestens eine) |
| `frage` | ja | Vorderseite der Karte |
| `antwort` | ja | Rückseite der Karte |
| `praxisbeispiel` | nein | Wird auf der Rückseite blau hinterlegt angezeigt |
| `fallbeispiel` | nein | Praxisfall mit Aufgabe, orange abgesetzt |
| `loesung` | nein | Lösung zum Fallbeispiel, per Button aufklappbar |
| `quelle` | nein | Kleine Quellenangabe unten |
| `phase` | nein | 1–6; fehlt das Feld, startet die Karte in Phase 1 |

Hinweise:
- Zeilenumbrüche im Text schreibt man als `\n`.
- Anführungszeichen innerhalb eines Textes müssen als `\"` geschrieben werden – oder man nutzt „deutsche Anführungszeichen“, die keine Probleme machen.
- Die Felder `format` und `version` erzeugt die App beim Export selbst; sie sind beim Import nicht nötig.
- Ein Export enthält die aktuellen Phasen. Importierst du ihn wieder, bleibt dein Lernstand erhalten – so kannst du Stapel sichern.
- Ein vollständiges Beispiel liegt in [`KarteiKarten/Resources/BWL-VWL-Grundbegriffe.json`](KarteiKarten/Resources/BWL-VWL-Grundbegriffe.json).

### Datei importieren
1. JSON-Datei auf dem iPhone in der **Dateien-App** ablegen (z. B. per AirDrop, aus einer Mail mit „In Dateien sichern“ oder über iCloud Drive).
2. In der App auf der Startseite oben links auf **Importieren** (Pfeil nach unten) tippen und die Datei auswählen.

### Stapel exportieren
Stapel öffnen → oben rechts **„…“** → **Als JSON exportieren** → Speicherort in der Dateien-App wählen.

---

## Neue Stapel mit Claude erstellen

Kopiere diesen Text in den Claude-Chat und passe Thema und Anzahl an:

> Erstelle mir einen Karteikarten-Stapel zum Thema **[THEMA]** mit **[ANZAHL]** Karten als JSON-Datei
> in genau diesem Format:
>
> ```json
> {
>   "name": "…",
>   "karten": [
>     { "frage": "…", "antwort": "…", "praxisbeispiel": "…", "fallbeispiel": "…", "loesung": "…", "quelle": "…" }
>   ]
> }
> ```
>
> Regeln: `frage` und `antwort` sind Pflicht. `antwort` ist eine präzise, verständliche Definition.
> `praxisbeispiel` ist ein kurzes Beispiel aus der Praxis. Gib einigen Karten zusätzlich ein
> `fallbeispiel` (kurzer Praxisfall mit konkreter Aufgabe) und die passende `loesung` mit Rechenweg.
> Nicht benötigte optionale Felder einfach weglassen. Zeilenumbrüche als `\n`.
> Gib nur gültiges JSON aus.

Die Antwort als `.json`-Datei speichern (z. B. `Marketing.json`) und wie oben beschrieben importieren.

---

## Projektaufbau

```
KarteiKarten.xcodeproj         Xcode-Projekt (zum Öffnen doppelklicken)
KarteiKarten/
  KarteiKartenApp.swift        Einstiegspunkt der App
  Logic/LearningEngine.swift   Lernlogik (Phasen, 5er-Gruppe, Rückgängig) – ohne UI, testbar
  Logic/StudySession.swift     Verbindet Lernlogik mit gespeicherten Karten, speichert nach jeder Aktion
  Model/Models.swift           SwiftData-Modelle Deck (Stapel) und Card (Karte), Statistik
  Transfer/DeckTransfer.swift  JSON-Import/-Export
  Transfer/SampleDeck.swift    Beispielstapel beim ersten Start
  Resources/…json              Inhalt des Beispielstapels
  Views/…                      Oberfläche (Stapelliste, Stapel, Lernen, Karte, Editor)
KarteiKartenTests/             Unit-Tests (Lernlogik, Import/Export, Speichern)
.github/workflows/ios.yml      Automatischer Build + Tests auf GitHub (macOS)
```
