import { PrivacyConfig } from './config';
import { REDACTORS, Redactor } from './redactors';

export interface Finding {
	category: string;
	count: number;
}

export interface SanitizeResult {
	// Text to send upstream. Equals the input unless mode is 'redact' and a
	// non-warn category matched.
	text: string;
	// Everything detected, including warn-only categories. Never contains the
	// matched values. Suitable for logging.
	findings: Finding[];
	// Only the detections that were actually replaced (excludes warn-only
	// categories). Use for user-facing notes.
	redactedFindings: Finding[];
	// True only in 'block' mode when a non-warn category matched. The caller
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

function runRedactors(text: string, redactors: Redactor[]): { text: string; findings: Finding[] } {
	const findings = new Map<string, number>();
	const alloc = new PlaceholderAllocator();
	let working = text;
	for (const redactor of redactors) {
		const res = redactor.redact(working, alloc.make(redactor.label));
		if (res.count > 0) {
			findings.set(redactor.id, (findings.get(redactor.id) ?? 0) + res.count);
			working = res.text;
		}
	}
	const findingList: Finding[] = [...findings.entries()]
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => a.category.localeCompare(b.category));
	return { text: working, findings: findingList };
}

/**
 * Scans a text for known PII/secret categories.
 *
 * Behaviour by mode:
 * - off:    no scanning, input returned unchanged
 * - warn:   detect only; text unchanged, findings reported for logging
 * - redact: replace matches with placeholders, findings reported
 * - block:  detect only; blocked=true when a non-warn category matched
 *
 * Categories listed in cfg.warnCategories are always detect-only: they appear
 * in `findings` but are never replaced and never trigger `blocked`.
 */
export function sanitizeText(text: string, cfg: PrivacyConfig): SanitizeResult {
	if (cfg.mode === 'off' || text.length === 0) {
		return { text, findings: [], redactedFindings: [], blocked: false, redacted: false };
	}

	const enabled = REDACTORS.filter((r) => !cfg.disabledCategories.has(r.id));

	// Full pass: everything detectable, for reporting/logging.
	const full = runRedactors(text, enabled);
	if (full.findings.length === 0) {
		return { text, findings: [], redactedFindings: [], blocked: false, redacted: false };
	}

	// Effective pass: warn-only categories stay untouched.
	const enforceable = enabled.filter((r) => !cfg.warnCategories.has(r.id));
	const effective =
		enforceable.length === enabled.length ? full : runRedactors(text, enforceable);

	if (cfg.mode === 'block') {
		return {
			text,
			findings: full.findings,
			redactedFindings: [],
			blocked: effective.findings.length > 0,
			redacted: false,
		};
	}
	if (cfg.mode === 'warn') {
		return { text, findings: full.findings, redactedFindings: [], blocked: false, redacted: false };
	}
	// redact
	return {
		text: effective.text,
		findings: full.findings,
		redactedFindings: effective.findings,
		blocked: false,
		redacted: effective.findings.length > 0,
	};
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
