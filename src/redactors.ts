// Redactors detect one PII/secret category each and replace matches with
// stable placeholders. Every redactor favours precision over recall: it must
// rather miss an exotic variant than redact legitimate content. Categories
// that rely on a checksum (IBAN, credit card, tax id) only replace values
// that pass validation.

export type AllocPlaceholder = (value: string) => string;

export interface Redactor {
	id: string;
	label: string;
	redact(text: string, alloc: AllocPlaceholder): { text: string; count: number };
}

function digitCount(s: string): number {
	let n = 0;
	for (const ch of s) {
		const c = ch.charCodeAt(0);
		if (c >= 48 && c <= 57) n++;
	}
	return n;
}

function countReplacements(before: string, after: string, label: string): number {
	// Placeholders are "[LABEL_n]"; count occurrences introduced by this pass.
	const re = new RegExp(`\\[${label}_\\d+\\]`, 'g');
	const beforeCount = (before.match(re) ?? []).length;
	const afterCount = (after.match(re) ?? []).length;
	return Math.max(0, afterCount - beforeCount);
}

/* ===== Checksum helpers ===== */

function mod97(s: string): number {
	let rem = 0;
	for (const ch of s) {
		const code = ch.charCodeAt(0);
		let val: number;
		if (code >= 48 && code <= 57) val = code - 48;
		else if (code >= 65 && code <= 90) val = code - 55; // A=10 .. Z=35
		else if (code >= 97 && code <= 122) val = code - 87; // a=10 .. z=35
		else continue;
		rem = val < 10 ? (rem * 10 + val) % 97 : (rem * 100 + val) % 97;
	}
	return rem;
}

export function isValidIban(compact: string): boolean {
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(compact)) return false;
	const upper = compact.toUpperCase();
	const rearranged = upper.slice(4) + upper.slice(0, 4);
	return mod97(rearranged) === 1;
}

export function luhnCheck(digits: string): boolean {
	if (!/^\d+$/.test(digits)) return false;
	let sum = 0;
	let dbl = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let d = digits.charCodeAt(i) - 48;
		if (dbl) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
		dbl = !dbl;
	}
	return sum % 10 === 0;
}

// German Steuer-Identifikationsnummer (11 digits, final digit is a checksum).
export function isValidDeTaxId(digits: string): boolean {
	if (!/^\d{11}$/.test(digits)) return false;
	if (digits[0] === '0') return false;
	let product = 10;
	for (let i = 0; i < 10; i++) {
		const d = digits.charCodeAt(i) - 48;
		let sum = (product + d) % 10;
		if (sum === 0) sum = 10;
		product = (sum * 2) % 11;
	}
	let check = 11 - product;
	if (check === 10) check = 0;
	return check === digits.charCodeAt(10) - 48;
}

/* ===== Redactors ===== */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const emailRedactor: Redactor = {
	id: 'email',
	label: 'EMAIL',
	redact(text, alloc) {
		const out = text.replace(EMAIL_RE, (m) => alloc(m));
		return { text: out, count: countReplacements(text, out, 'EMAIL') };
	},
};

// Phone candidates must start with +, 00 or a leading 0 (German/international
// trunk prefix) and carry 7..15 digits in total. This is inherently fuzzy and
// the most likely category to produce false positives; it can be disabled.
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}|00\d{1,3}|0\d{2,5})(?:[\s\-/.()]*\d{1,6}){1,6}(?!\d)/g;

// IBANs and card numbers are written in groups of exactly four digits. Phone
// numbers virtually never use two or more uniform 4-digit groups, so such
// candidates are skipped to avoid mis-redacting payment data remnants.
function hasUniformFourDigitGroups(m: string): boolean {
	const groups = m.split(/[\s\-/.()]+/).filter(Boolean);
	let fourDigitGroups = 0;
	for (const g of groups) {
		if (/^\d{4}$/.test(g)) fourDigitGroups++;
	}
	return fourDigitGroups >= 2;
}

const phoneRedactor: Redactor = {
	id: 'phone',
	label: 'PHONE',
	redact(text, alloc) {
		const out = text.replace(PHONE_RE, (m) => {
			const digits = digitCount(m);
			if (digits < 7 || digits > 15) return m;
			if (hasUniformFourDigitGroups(m)) return m;
			return alloc(m);
		});
		return { text: out, count: countReplacements(text, out, 'PHONE') };
	},
};

// IBAN printed in groups; BBAN may contain letters. Validated with mod-97.
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;

const ibanRedactor: Redactor = {
	id: 'iban',
	label: 'IBAN',
	redact(text, alloc) {
		const out = text.replace(IBAN_RE, (m) => {
			const compact = m.replace(/\s+/g, '');
			return isValidIban(compact) ? alloc(m) : m;
		});
		return { text: out, count: countReplacements(text, out, 'IBAN') };
	},
};

// Credit-card-like runs of 13..19 digits (optionally separated), Luhn-checked.
const CC_RE = /\b(?:\d[ \-]?){12,18}\d\b/g;

const creditCardRedactor: Redactor = {
	id: 'credit_card',
	label: 'CARD',
	redact(text, alloc) {
		const out = text.replace(CC_RE, (m) => {
			const digits = m.replace(/[ \-]/g, '');
			if (digits.length < 13 || digits.length > 19) return m;
			return luhnCheck(digits) ? alloc(m) : m;
		});
		return { text: out, count: countReplacements(text, out, 'CARD') };
	},
};

// Credentials embedded in URLs: scheme://user:pass@host  ->  scheme://[...]@host
const URL_CRED_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^:@\s/]+):([^@\s]+)@/gi;

const urlCredentialsRedactor: Redactor = {
	id: 'url_credentials',
	label: 'CREDENTIALS',
	redact(text, alloc) {
		const out = text.replace(URL_CRED_RE, (_m, scheme: string) => `${scheme}://${alloc('credentials')}@`);
		return { text: out, count: countReplacements(text, out, 'CREDENTIALS') };
	},
};

// Well-known secret/key shapes. Deliberately limited to high-confidence
// provider prefixes; generic "long random string" detection is too noisy.
const SECRET_PATTERNS: Array<RegExp> = [
	/\bsk-(?:proj-|ant-)?[A-Za-z0-9_\-]{16,}\b/g, // OpenAI / Anthropic / OpenRouter (sk-or-v1-…)
	/\bpplx-[A-Za-z0-9]{16,}\b/g, // Perplexity
	/\bre_[A-Za-z0-9]{16,}\b/g, // Resend
	/\bSK[0-9a-fA-F]{32}\b/g, // Twilio API key
	/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe style
	/\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
	/\bASIA[0-9A-Z]{16}\b/g, // AWS temporary access key id
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PAT
	/\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g, // Slack
	/\bAIza[0-9A-Za-z_\-]{35}\b/g, // Google API key
];

const secretKeyRedactor: Redactor = {
	id: 'secret_key',
	label: 'SECRET',
	redact(text, alloc) {
		let out = text;
		for (const re of SECRET_PATTERNS) {
			out = out.replace(re, (m) => alloc(m));
		}
		return { text: out, count: countReplacements(text, out, 'SECRET') };
	},
};

// JSON Web Tokens: three base64url segments, header starts with "eyJ".
const JWT_RE = /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g;

const jwtRedactor: Redactor = {
	id: 'jwt',
	label: 'SECRET',
	redact(text, alloc) {
		const out = text.replace(JWT_RE, (m) => alloc(m));
		return { text: out, count: countReplacements(text, out, 'SECRET') };
	},
};

// PEM private-key blocks (with or without the END marker).
const PEM_RE = /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]{0,4000}?(?:-----END[ A-Z]*PRIVATE KEY-----|(?=\n\n)|$)/g;

const pemKeyRedactor: Redactor = {
	id: 'pem_key',
	label: 'SECRET',
	redact(text, alloc) {
		const out = text.replace(PEM_RE, (m) => alloc(m));
		return { text: out, count: countReplacements(text, out, 'SECRET') };
	},
};

// German tax id: 11 digits, either as a plain run or spaced 2-3-3-3.
const TAX_RE = /\b\d{2} \d{3} \d{3} \d{3}\b|\b\d{11}\b/g;

const deTaxIdRedactor: Redactor = {
	id: 'de_tax_id',
	label: 'TAX_ID',
	redact(text, alloc) {
		const out = text.replace(TAX_RE, (m) => {
			const digits = m.replace(/\s+/g, '');
			return isValidDeTaxId(digits) ? alloc(m) : m;
		});
		return { text: out, count: countReplacements(text, out, 'TAX_ID') };
	},
};

// Order matters: specific/high-confidence patterns run first so their
// placeholders are not re-matched by fuzzier redactors later.
export const REDACTORS: Redactor[] = [
	pemKeyRedactor,
	jwtRedactor,
	urlCredentialsRedactor,
	secretKeyRedactor,
	emailRedactor,
	ibanRedactor,
	creditCardRedactor,
	deTaxIdRedactor,
	phoneRedactor,
];

export const REDACTOR_IDS = REDACTORS.map((r) => r.id);
