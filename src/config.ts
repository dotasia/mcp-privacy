export type PrivacyMode = 'off' | 'warn' | 'redact' | 'block';

export interface PrivacyConfig {
	mode: PrivacyMode;
	disabledCategories: Set<string>;
	// Categories that are detected and reported but never replaced or used to
	// block, regardless of the mode (e.g. email addresses that a downstream
	// workflow legitimately needs).
	warnCategories: Set<string>;
}

const VALID_MODES: ReadonlySet<string> = new Set(['off', 'warn', 'redact', 'block']);

/**
 * Parses privacy settings from environment variables.
 *
 * Recognized variables:
 * - PRIVACY_MODE: off | warn | redact | block (default: warn)
 * - PRIVACY_DISABLED_CATEGORIES: comma-separated redactor ids to skip (optional)
 * - PRIVACY_WARN_CATEGORIES: comma-separated redactor ids that are detected
 *   and reported but never replaced/blocked (optional)
 *
 * Unknown modes fall back to the safe default 'warn' so a typo never
 * silently disables detection.
 */
export function parsePrivacyConfig(env: Record<string, unknown>): PrivacyConfig {
	const rawMode = typeof env.PRIVACY_MODE === 'string' ? env.PRIVACY_MODE.trim().toLowerCase() : '';
	const mode: PrivacyMode = VALID_MODES.has(rawMode) ? (rawMode as PrivacyMode) : 'warn';

	const parseList = (value: unknown): Set<string> =>
		new Set(
			(typeof value === 'string' ? value : '')
				.split(',')
				.map((s) => s.trim().toLowerCase())
				.filter((s) => s.length > 0),
		);

	return {
		mode,
		disabledCategories: parseList(env.PRIVACY_DISABLED_CATEGORIES),
		warnCategories: parseList(env.PRIVACY_WARN_CATEGORIES),
	};
}
