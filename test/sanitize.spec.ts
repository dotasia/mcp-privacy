import { describe, it, expect } from 'vitest';
import { sanitizeText, formatPrivacyNote } from '../src/sanitize';
import type { PrivacyConfig } from '../src/config';

const cfg = (mode: PrivacyConfig['mode'], disabled: string[] = [], warn: string[] = []): PrivacyConfig => ({
	mode,
	disabledCategories: new Set(disabled),
	warnCategories: new Set(warn),
});

const SAMPLE = 'Kontakt max@example.com, IBAN DE89 3704 0044 0532 0130 00.';

describe('sanitizeText modes', () => {
	it('off: returns input unchanged with no findings', () => {
		const r = sanitizeText(SAMPLE, cfg('off'));
		expect(r.text).toBe(SAMPLE);
		expect(r.findings).toEqual([]);
		expect(r.blocked).toBe(false);
		expect(r.redacted).toBe(false);
	});

	it('warn: detects but does not modify the text', () => {
		const r = sanitizeText(SAMPLE, cfg('warn'));
		expect(r.text).toBe(SAMPLE);
		expect(r.redacted).toBe(false);
		expect(r.blocked).toBe(false);
		expect(r.findings.map((f) => f.category).sort()).toEqual(['email', 'iban']);
	});

	it('redact: replaces matches and reports findings', () => {
		const r = sanitizeText(SAMPLE, cfg('redact'));
		expect(r.redacted).toBe(true);
		expect(r.text).toContain('[EMAIL_1]');
		expect(r.text).toContain('[IBAN_1]');
		expect(r.text).not.toContain('max@example.com');
		expect(r.findings.map((f) => f.category).sort()).toEqual(['email', 'iban']);
	});

	it('block: reports blocked and leaves text unchanged', () => {
		const r = sanitizeText(SAMPLE, cfg('block'));
		expect(r.blocked).toBe(true);
		expect(r.text).toBe(SAMPLE);
		expect(r.findings.length).toBeGreaterThan(0);
	});

	it('clean text: no findings in any active mode', () => {
		const clean = 'Eine völlig harmlose Sachfrage ohne Personenbezug.';
		for (const mode of ['warn', 'redact', 'block'] as const) {
			const r = sanitizeText(clean, cfg(mode));
			expect(r.findings).toEqual([]);
			expect(r.text).toBe(clean);
			expect(r.blocked).toBe(false);
			expect(r.redacted).toBe(false);
		}
	});

	it('empty text is a no-op', () => {
		const r = sanitizeText('', cfg('redact'));
		expect(r.text).toBe('');
		expect(r.findings).toEqual([]);
	});
});

describe('disabled categories', () => {
	it('skips a disabled redactor entirely', () => {
		const r = sanitizeText(SAMPLE, cfg('redact', ['email']));
		expect(r.text).toContain('max@example.com');
		expect(r.text).toContain('[IBAN_1]');
		expect(r.findings.map((f) => f.category)).toEqual(['iban']);
	});
});

describe('warn-only categories', () => {
	it('redact: warn category is detected but not replaced', () => {
		const r = sanitizeText(SAMPLE, cfg('redact', [], ['email']));
		expect(r.redacted).toBe(true);
		expect(r.text).toContain('max@example.com');
		expect(r.text).toContain('[IBAN_1]');
		// full detection list (for logging) includes both
		expect(r.findings.map((f) => f.category).sort()).toEqual(['email', 'iban']);
		// replaced list excludes the warn-only category
		expect(r.redactedFindings.map((f) => f.category)).toEqual(['iban']);
	});

	it('redact: text with only warn-category matches stays unchanged', () => {
		const input = 'Nur eine Adresse: max@example.com';
		const r = sanitizeText(input, cfg('redact', [], ['email']));
		expect(r.text).toBe(input);
		expect(r.redacted).toBe(false);
		expect(r.redactedFindings).toEqual([]);
		expect(r.findings).toEqual([{ category: 'email', count: 1 }]);
	});

	it('block: warn-category matches do not trigger blocking', () => {
		const onlyEmail = sanitizeText('Nur max@example.com hier.', cfg('block', [], ['email']));
		expect(onlyEmail.blocked).toBe(false);
		expect(onlyEmail.findings).toEqual([{ category: 'email', count: 1 }]);

		const mixed = sanitizeText(SAMPLE, cfg('block', [], ['email']));
		expect(mixed.blocked).toBe(true);
	});

	it('the privacy note only counts replaced findings', () => {
		const r = sanitizeText(SAMPLE, cfg('redact', [], ['email']));
		const note = formatPrivacyNote(r.redactedFindings);
		expect(note).toContain('1 vertrauliche Angabe(n)');
		expect(note).toContain('iban: 1');
		expect(note).not.toContain('email');
	});
});

describe('findings shape', () => {
	it('aggregates counts per category and never leaks values', () => {
		const r = sanitizeText('a@x.de und b@y.de sowie c@z.de', cfg('redact'));
		const email = r.findings.find((f) => f.category === 'email');
		expect(email?.count).toBe(3);
		// findings must be serializable metadata only
		expect(JSON.stringify(r.findings)).not.toContain('@x.de');
	});
});

describe('formatPrivacyNote', () => {
	it('returns undefined for empty findings', () => {
		expect(formatPrivacyNote([])).toBeUndefined();
	});
	it('builds a German note with totals', () => {
		const note = formatPrivacyNote([
			{ category: 'email', count: 2 },
			{ category: 'iban', count: 1 },
		]);
		expect(note).toContain('3 vertrauliche Angabe(n)');
		expect(note).toContain('email: 2');
		expect(note).toContain('iban: 1');
	});
});
