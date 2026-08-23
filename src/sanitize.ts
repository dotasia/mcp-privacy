import { PrivacyConfig } from './config';
import { REDACTORS } from './redactors';

export interface Finding {
	category: string;
	count: number;
}

export interface SanitizeResult {
	// Text to send upstream. Equals the input unless mode is 'redact' and
	// something matched.
	text: string;
	// Detected categories and match counts. Never contains the matched values.
	findings: Finding[];
	// True only in 'block' mode when at least one match was found. The caller
	// must refuse the request and never send it upstream.
	blocked: boolean;
	// True when matches were found and removed (mode 'redact').
	redacted: boolean;
}

// Assigns stable placeholders so identical values map to the same placeholder
// within one text ("max@example.com" twice -> [EMAIL_1] both times). Counters
// and the value-map are keyed by placeholder label, so categories that share a
// label (e.g. SECRET for secret_key/jwt/pem_key) continue one numbering and
// never collide.
class PlaceholderAllocator {
	private valuesByLabel = new Map<string, Map<string, string>>();
	private counters = new Map<string, number>();

	make(label: string): (value: string) => string {
		return (value: string) => {
			let map = this.valuesByLabel.get(label);
			if (!map) {
				map = new Map();
				this.valuesByLabel.set(label, map);
			}
			const existing = map.get(value);
			if (existing) return existing;
			const n = (this.counters.get(label) ?? 0) + 1;
			this.counters.set(label, n);
			const ph = `[${label}_${n}]`;
			map.set(value, ph);
			return ph;
		};
	}
}

/**
 * Scans a text for known PII/secret categories.
 *
 * Behaviour by mode:
 * - off:    no scanning, input returned unchanged
 * - warn:   detect only; text unchanged, findings reported for logging
 * - redact: replace matches with placeholders, findings reported
 * - block:  detect only; blocked=true when anything matched
 */
export function sanitizeText(text: string, cfg: PrivacyConfig): SanitizeResult {
	if (cfg.mode === 'off' || text.length === 0) {
		return { text, findings: [], blocked: false, redacted: false };
	}

	const findings = new Map<string, number>();
	const alloc = new PlaceholderAllocator();

	let working = text;
	for (const redactor of REDACTORS) {
		if (cfg.disabledCategories.has(redactor.id)) continue;
		const res = redactor.redact(working, alloc.make(redactor.label));
		if (res.count > 0) {
			findings.set(redactor.id, (findings.get(redactor.id) ?? 0) + res.count);
			working = res.text;
		}
	}

	const findingList: Finding[] = [...findings.entries()]
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => a.category.localeCompare(b.category));

	if (findingList.length === 0) {
		return { text, findings: [], blocked: false, redacted: false };
	}

	if (cfg.mode === 'block') {
		return { text, findings: findingList, blocked: true, redacted: false };
	}
	if (cfg.mode === 'warn') {
		return { text, findings: findingList, blocked: false, redacted: false };
	}
	// redact
	return { text: working, findings: findingList, blocked: false, redacted: true };
}

/**
 * Human-readable note (German) for tool results when data was redacted, so the
 * calling LLM can inform the user. Returns undefined when nothing was found.
 */
export function formatPrivacyNote(findings: Finding[]): string | undefined {
	if (findings.length === 0) return undefined;
	const total = findings.reduce((sum, f) => sum + f.count, 0);
	const parts = findings.map((f) => `${f.category}: ${f.count}`).join(', ');
	return `Datenschutz-Hinweis: ${total} vertrauliche Angabe(n) wurden vor der Übertragung an das Sprachmodell entfernt (${parts}).`;
}
