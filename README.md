# @dotasia/mcp-privacy

Deterministische PII-/Secret-Redaktion für MCP-Server (Cloudflare Workers).

Das Modul filtert personenbezogene Daten und Geheimnisse aus Texten, **bevor**
sie den Server in Richtung eines externen LLM-Providers verlassen. Es ist die
serverseitige, erzwingbare Ergänzung zu Datenschutz-Anweisungen im
Client-Prompt (die ein Modell ignorieren kann).

## Prinzip

- **Deterministisch**: Regex- und Checksummen-Prüfung, kein LLM, keine
  Heuristik-Ratefunktion. Kein zusätzlicher Upstream-Call, keine Latenz.
- **Präzision vor Vollständigkeit**: Lieber eine exotische Variante
  übersehen als legitimen Inhalt schwärzen. Kategorien mit Prüfziffer
  (IBAN, Kreditkarte, Steuer-ID) ersetzen nur gültige Werte.
- **Auditierbar**: Die Fundstellen werden als Kategorien + Anzahl gemeldet,
  niemals die erkannten Werte selbst.

## Installation

Das Paket wird als GitHub-Dependency eingebunden (kein npm-Account nötig):

```jsonc
// package.json
{
  "dependencies": {
    "@dotasia/mcp-privacy": "github:dotasia/mcp-privacy#v0.1.0"
  }
}
```

Für lokale Entwicklung gegen eine Arbeitskopie:

```jsonc
{ "dependencies": { "@dotasia/mcp-privacy": "file:../mcp-privacy" } }
```

## Nutzung

```ts
import { parsePrivacyConfig, sanitizeText, formatPrivacyNote } from '@dotasia/mcp-privacy';

// Einmal pro Request aus den Env-Variablen lesen
const privacy = parsePrivacyConfig(env);

// Auf jedes Nutzfeld anwenden (query, input, system, ...)
const result = sanitizeText(userText, privacy);

if (result.blocked) {
  // Modus 'block': Request ablehnen, nichts geht upstream.
  return rejectRequest(result.findings);
}

const outgoing = result.text; // im Modus 'redact' bereits anonymisiert
// Hinweis nur aus tatsächlich ersetzten Funden bauen (ohne Warn-Kategorien)
const note = result.redacted ? formatPrivacyNote(result.redactedFindings) : undefined;
```

## Modi (`PRIVACY_MODE`)

| Modus    | Verhalten                                                            |
| -------- | -------------------------------------------------------------------- |
| `off`    | Kein Scanning.                                                        |
| `warn`   | Erkennen und melden, Text bleibt unverändert (Beobachtungsphase).     |
| `redact` | Treffer werden durch Platzhalter ersetzt, Request läuft weiter.       |
| `block`  | Bei einem Treffer wird der Request blockiert (geht nicht upstream).   |

Unbekannte Werte fallen auf `warn` zurück, damit ein Tippfehler den Schutz
nicht stillschaltet.

## Platzhalter

Identische Werte bekommen denselben Platzhalter, damit der Text für das Modell
nachvollziehbar bleibt:

```
max@example.com ... max@example.com   ->  [EMAIL_1] ... [EMAIL_1]
zweite@adresse.de                     ->  [EMAIL_2]
```

## Kategorien

| ID               | Label         | Methode                                  |
| ---------------- | ------------- | ---------------------------------------- |
| `email`          | `EMAIL`       | Regex                                     |
| `phone`          | `PHONE`       | Regex + Ziffernanzahl (7–15)              |
| `iban`           | `IBAN`        | Regex + Mod-97-Prüfziffer                 |
| `credit_card`    | `CARD`        | Regex + Luhn-Check                        |
| `de_tax_id`      | `TAX_ID`      | Regex + Prüfziffer (Steuer-ID)            |
| `url_credentials`| `CREDENTIALS` | `scheme://user:pass@host`                 |
| `secret_key`     | `SECRET`      | Bekannte Provider-Key-Muster              |
| `jwt`            | `SECRET`      | Drei Base64url-Segmente (`eyJ...`)        |
| `pem_key`        | `SECRET`      | `-----BEGIN ... PRIVATE KEY-----`         |

Einzelne Kategorien lassen sich per `PRIVACY_DISABLED_CATEGORIES` abschalten
(kommagetrennte IDs), z. B. `PRIVACY_DISABLED_CATEGORIES=phone`.

### Warn-Kategorien (`PRIVACY_WARN_CATEGORIES`)

Kategorien, die zwar erkannt und gemeldet, aber **niemals ersetzt oder
blockiert** werden sollen – z. B. wenn ein MCP E-Mail-Adressen für seine
Aufgabe braucht:

```
PRIVACY_MODE=redact
PRIVACY_WARN_CATEGORIES=email
```

Effekt: Alle Kategorien außer `email` werden ersetzt; `email` erscheint nur in
`findings` (Logging), bleibt im Text aber unangetastet und löst im Modus
`block` auch keine Blockade aus. `result.findings` enthält alle Funde,
`result.redactedFindings` nur die tatsächlich ersetzten.

## Bekannte Grenzen

- Namen, Straßenadressen und Freitext-Gesundheitsdaten sind per Regex nicht
  zuverlässig erkennbar und werden **nicht** erfasst. Dafür bleibt der
  Client-Prompt (oder später ein optionaler LLM-Anonymisierungspass) zuständig.
- `phone` ist die anfälligste Kategorie für False Positives und kann per
  Config deaktiviert werden.

## Entwicklung

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```
