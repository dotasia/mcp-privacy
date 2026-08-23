import { describe, it, expect } from 'vitest';
import { isValidIban, luhnCheck, isValidDeTaxId, REDACTORS, REDACTOR_IDS } from '../src/redactors';
import { sanitizeText } from '../src/sanitize';

const redact = (text: string) =>
	sanitizeText(text, { mode: 'redact', disabledCategories: new Set(), warnCategories: new Set() });

describe('checksum helpers', () => {
	it('validates a correct IBAN (mod-97)', () => {
		expect(isValidIban('DE89370400440532013000')).toBe(true);
	});
	it('rejects an IBAN with a wrong check digit', () => {
		expect(isValidIban('DE89370400440532013001')).toBe(false);
	});
	it('rejects malformed IBANs', () => {
		expect(isValidIban('DE89')).toBe(false);
		expect(isValidIban('1234567890123456')).toBe(false);
	});

	it('passes Luhn for known card numbers', () => {
		expect(luhnCheck('4111111111111111')).toBe(true);
		expect(luhnCheck('4242424242424242')).toBe(true);
	});
	it('fails Luhn for an altered digit', () => {
		expect(luhnCheck('4111111111111112')).toBe(false);
	});

	it('validates a correct German tax id', () => {
		expect(isValidDeTaxId('12345678903')).toBe(true);
		expect(isValidDeTaxId('99999999994')).toBe(true);
	});
	it('rejects tax ids with wrong checksum or leading zero', () => {
		expect(isValidDeTaxId('12345678901')).toBe(false);
		expect(isValidDeTaxId('01234567890')).toBe(false);
		expect(isValidDeTaxId('1234567890')).toBe(false);
	});
});

describe('redactor registry', () => {
	it('exposes stable ids', () => {
		expect(REDACTOR_IDS).toEqual([
			'pem_key',
			'jwt',
			'url_credentials',
			'secret_key',
			'email',
			'iban',
			'credit_card',
			'de_tax_id',
			'phone',
		]);
	});
	it('has unique ids', () => {
		expect(new Set(REDACTOR_IDS).size).toBe(REDACTORS.length);
	});
});

describe('email', () => {
	it('redacts simple and dotted addresses', () => {
		const r = redact('Schreib an max.mustermann@example.com und a+b@foo-bar.de.');
		expect(r.text).toContain('[EMAIL_1]');
		expect(r.text).toContain('[EMAIL_2]');
		expect(r.text).not.toContain('example.com');
		expect(r.findings).toEqual([{ category: 'email', count: 2 }]);
	});
	it('reuses the same placeholder for a repeated address', () => {
		const r = redact('max@example.com und nochmal max@example.com');
		expect(r.text).toBe('[EMAIL_1] und nochmal [EMAIL_1]');
	});
});

describe('phone', () => {
	it('redacts German and international formats', () => {
		expect(redact('Ruf mich an: 0171 1234567').text).toContain('[PHONE_1]');
		expect(redact('Büro: +49 30 1234567').text).toContain('[PHONE_1]');
		expect(redact('Alt: 0049 89 123456').text).toContain('[PHONE_1]');
	});
	it('does not redact short numbers or plain years', () => {
		expect(redact('Im Jahr 2024 passierte es.').text).toBe('Im Jahr 2024 passierte es.');
		expect(redact('Artikel 5 Grundgesetz').text).toBe('Artikel 5 Grundgesetz');
	});
	it('skips uniform 4-digit groupings (IBAN/card remnants)', () => {
		const input = 'Buchung 0123 4567 8901 bitte prüfen.';
		expect(redact(input).text).toBe(input);
	});
});

describe('iban', () => {
	it('redacts a valid spaced IBAN', () => {
		const r = redact('Überweise an DE89 3704 0044 0532 0130 00 bitte.');
		expect(r.text).toContain('[IBAN_1]');
		expect(r.text).not.toContain('3704');
	});
	it('leaves an invalid IBAN untouched', () => {
		const input = 'Falsch: DE00 3704 0044 0532 0130 00';
		expect(redact(input).text).toBe(input);
	});
});

describe('credit_card', () => {
	it('redacts a Luhn-valid card number (with separators)', () => {
		const r = redact('Karte 4111 1111 1111 1111 belasten.');
		expect(r.text).toContain('[CARD_1]');
		expect(r.text).not.toContain('4111 1111');
	});
	it('leaves Luhn-invalid runs untouched', () => {
		const input = 'Nummer 1234 5678 9012 3456 ist keine Karte.';
		expect(redact(input).text).toBe(input);
	});
});

describe('url_credentials', () => {
	it('redacts user and password but keeps scheme and host', () => {
		const r = redact('Verbinde postgres://admin:s3cr3t@db.example.com:5432/app jetzt.');
		expect(r.text).toContain('postgres://[CREDENTIALS_1]@db.example.com:5432/app');
		expect(r.text).not.toContain('s3cr3t');
	});
	it('leaves URLs without credentials untouched', () => {
		const input = 'Siehe https://example.com/pfad für Details.';
		expect(redact(input).text).toBe(input);
	});
});

describe('secret_key', () => {
	it('redacts OpenAI-style keys', () => {
		const r = redact('Nutze Schlüssel sk-proj-AbCdEf1234567890GhIjKl987654 bitte.');
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain('sk-proj-');
	});
	it('redacts AWS access key ids', () => {
		const r = redact('AWS AKIAIOSFODNN7EXAMPLE konfigurieren.');
		expect(r.text).toContain('[SECRET_1]');
	});
	it('redacts GitHub tokens', () => {
		const r = redact('Token ghp_ABCDEFghijklmnop1234567890QRSTUVWXYZ0 aktiv.');
		expect(r.text).toContain('[SECRET_1]');
	});
	it('redacts Perplexity keys', () => {
		const r = redact('Mein Schlüssel pplx-9f8e7d6c5b4a39281716 ist geheim.');
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain('pplx-9f8e7d6c5b4a39281716');
	});
	it('redacts OpenRouter keys', () => {
		const r = redact('Der Key sk-or-v1-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 darf nicht raus.');
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain('sk-or-v1-');
	});
	it('redacts Resend keys', () => {
		const r = redact('RESEND_API_KEY=re_A1b2C3d4E5f6G7h8I9j0K1l2 gesetzt.');
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain('re_A1b2C3d4E5f6G7h8I9j0K1l2');
	});
	it('redacts Twilio API keys', () => {
		// Assembled at runtime so the fixture never appears as one contiguous
		// literal; GitHub push protection would otherwise flag it as a live key.
		const twilioKey = 'SK36a1b2c3d4e5f6' + 'a7b8c9d0e1f2a3b4c5';
		const r = redact(`TWILIO_API_KEY=${twilioKey} aktiv.`);
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain(twilioKey);
	});
});

describe('jwt', () => {
	it('redacts a three-segment token', () => {
		const jwt =
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
		const r = redact(`Bearer ${jwt} senden.`);
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain('eyJzdWIi');
	});
});

describe('pem_key', () => {
	it('redacts a full private key block', () => {
		const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----';
		const r = redact(`Hier der Key:\n${pem}\nDanke.`);
		expect(r.text).toContain('[SECRET_1]');
		expect(r.text).not.toContain('MIIEpAIBAAKCAQEA7');
		expect(r.text).toContain('Danke.');
	});
});

describe('de_tax_id', () => {
	it('redacts a valid tax id (plain and spaced)', () => {
		expect(redact('IdNr 12345678903 hinterlegt.').text).toContain('[TAX_ID_1]');
		expect(redact('IdNr 12 345 678 903 hinterlegt.').text).toContain('[TAX_ID_1]');
	});
	it('leaves an invalid checksum untouched', () => {
		const input = 'Falsch 12345678901.';
		expect(redact(input).text).toBe(input);
	});
});
