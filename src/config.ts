export type PrivacyMode = 'off' | 'warn' | 'redact' | 'block';

export interface PrivacyConfig {
	mode: PrivacyMode;
	disabledCategories: Set<string>;
}

const VALID_MODES: ReadonlySet<string> = new Set(['off', 'warn', 'redact', 'block']);

/**
 * Parses privacy settings from environment variables.
 *
 * Recognized variables:
 * - PRIVACY_MODE: off | warn | redact | block (default: warn)
 * - PRIVACY_DISABLED_CATEGORIES: comma-separated redactor ids to skip (optional)
 *
 * Unknown modes fall back to the safe default 'warn' so a typo never
 * silently disables detection.
 */
export function parsePrivacyConfig(env: Record<string, unknown>): PrivacyConfig {
	const rawMode = typeof env.PRIVACY_MODE === 'string' ? env.PRIVACY_MODE.trim().toLowerCase() : '';
	const mode: PrivacyMode = VALID_MODES.has(rawMode) ? (rawMode as PrivacyMode) : 'warn';

	const rawDisabled =
		typeof env.PRIVACY_DISABLED_CATEGORIES === 'string' ? env.PRIVACY_DISABLED_CATEGORIES : '';
	const disabledCategories = new Set(
		rawDisabled
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter((s) => s.length > 0),
	);

	return { mode, disabledCategories };
}
