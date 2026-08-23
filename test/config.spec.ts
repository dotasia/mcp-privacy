import { describe, it, expect } from 'vitest';
import { parsePrivacyConfig } from '../src/config';

describe('parsePrivacyConfig', () => {
	it('defaults to warn when nothing is set', () => {
		const cfg = parsePrivacyConfig({});
		expect(cfg.mode).toBe('warn');
		expect(cfg.disabledCategories.size).toBe(0);
	});

	it('accepts each valid mode (case-insensitive)', () => {
		for (const mode of ['off', 'warn', 'redact', 'block']) {
			expect(parsePrivacyConfig({ PRIVACY_MODE: mode }).mode).toBe(mode);
			expect(parsePrivacyConfig({ PRIVACY_MODE: mode.toUpperCase() }).mode).toBe(mode);
		}
	});

	it('falls back to warn on unknown mode', () => {
		expect(parsePrivacyConfig({ PRIVACY_MODE: 'banana' }).mode).toBe('warn');
		expect(parsePrivacyConfig({ PRIVACY_MODE: '' }).mode).toBe('warn');
	});

	it('parses disabled categories and trims/normalizes them', () => {
		const cfg = parsePrivacyConfig({ PRIVACY_DISABLED_CATEGORIES: 'phone, Email ,PHONE' });
		expect(cfg.disabledCategories.has('phone')).toBe(true);
		expect(cfg.disabledCategories.has('email')).toBe(true);
		expect(cfg.disabledCategories.size).toBe(2);
	});

	it('ignores empty disabled entries', () => {
		const cfg = parsePrivacyConfig({ PRIVACY_DISABLED_CATEGORIES: ',,,' });
		expect(cfg.disabledCategories.size).toBe(0);
	});
});
