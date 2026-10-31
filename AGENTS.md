# AGENTS.md – mcp-privacy

Kein Worker, sondern Bibliothek `@dotasia/mcp-privacy` (TypeScript, Quellcode direkt als Paket: `main`/`exports` zeigen auf `src/index.ts`, kein Build-Schritt): deterministische PII-/Secret-Redaktion (Regex + Prüfziffern, kein LLM) für MCP-Server, bevor Text an externe LLM-Provider geht. `README.md` ist die Referenz (API, Modi, Kategorien).

## Befehle

- Verifikation: `npm run typecheck && npm test` (Vitest im Node-Environment, `test/**/*.spec.ts`; kein Workers-Pool).
- Einzeltest: `npx vitest run test/redactors.spec.ts`.
- Kein Linter/Formatter.

## Cloudflare / Deploy

- Keine `wrangler`-Config, kein Worker, keine Check-Runs, keine GitHub Actions → nichts zu deployen und keine Cloudflare-Account-Zuordnung.
- Verteilung erfolgt über Git-Tags: Konsumenten (`mcp-openai`, `mcp-pplx`) binden `github:dotasia/mcp-privacy#vX.Y.Z` ein (Lockfile `git+ssh`). Aktuelles Tag: `v0.3.0` (entspricht `package.json`-Version). Änderungen werden für Konsumenten erst mit neuem Tag plus Anpassung von deren `package.json`/Lockfile wirksam; Tags nur auf ausdrücklichen Auftrag setzen oder pushen.

## Architektur

- `src/index.ts` Exporte (u. a. `parsePrivacyConfig`, `sanitizeText`, `formatPrivacyNote`), `src/config.ts` liest Env, `src/sanitize.ts` Orchestrierung, `src/redactors.ts` die einzelnen Redaktoren.
- Env-Schalter (von Konsumenten per `vars` gesetzt): `PRIVACY_MODE` (`off` | `warn` | `redact` | `block`; Default `warn`), `PRIVACY_DISABLED_CATEGORIES`, `PRIVACY_WARN_CATEGORIES` (nur erkennen/melden, nicht ersetzen).
- Designregel: Präzision vor Vollständigkeit. Kategorien mit Prüfziffer (IBAN, Kreditkarte, Steuer-ID) ersetzen nur gültige Werte; lieber eine Variante übersehen als legitimen Text schwärzen.
- Funde werden nur als Kategorie + Anzahl gemeldet, nie die erkannten Werte (weder in Ergebnissen noch in Logs oder Tests-Ausgaben).
- Neue Redaktoren brauchen Tests in `test/redactors.spec.ts` (positiv und negativ/False-Positive).

## Konventionen

- Conventional Commits (`feat:`, `fix:`, …).
