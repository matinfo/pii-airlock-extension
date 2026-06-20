import { describe, it, expect } from 'bun:test';
import { detectRegex } from '../../lib/detection/regex';

// ── helpers ──────────────────────────────────────────────────────────────────

function types(text: string) {
  return detectRegex(text).map((d) => d.entityType);
}

function firstMatch(text: string, type: string) {
  return detectRegex(text).find((d) => d.entityType === type);
}

function hasType(text: string, type: string) {
  return detectRegex(text).some((d) => d.entityType === type);
}

// ── Email ─────────────────────────────────────────────────────────────────────

describe('EMAIL_ADDRESS', () => {
  it('detects simple email', () => {
    expect(hasType('reach me at john@example.com please', 'EMAIL_ADDRESS')).toBe(true);
  });

  it('detects email with plus', () => {
    expect(hasType('john+tag@acme.co.uk', 'EMAIL_ADDRESS')).toBe(true);
  });

  it('does not flag plain text', () => {
    expect(hasType('hello world', 'EMAIL_ADDRESS')).toBe(false);
  });

  it('preserves correct span', () => {
    const text = 'mail: foo@bar.com today';
    const d = firstMatch(text, 'EMAIL_ADDRESS')!;
    expect(text.slice(d.start, d.end)).toBe('foo@bar.com');
  });
});

// ── Phone ─────────────────────────────────────────────────────────────────────

describe('PHONE_NUMBER', () => {
  it('detects US format', () => {
    expect(hasType('call (555) 867-5309 now', 'PHONE_NUMBER')).toBe(true);
  });

  it('detects international format', () => {
    expect(hasType('+33 6 12 34 56 78', 'PHONE_NUMBER')).toBe(true);
  });

  it('detects E.164 format', () => {
    expect(hasType('+14155552671', 'PHONE_NUMBER')).toBe(true);
  });
});

// ── Credit card ───────────────────────────────────────────────────────────────

describe('CREDIT_CARD', () => {
  it('detects Visa with spaces (Luhn valid)', () => {
    expect(hasType('card: 4111 1111 1111 1111', 'CREDIT_CARD')).toBe(true);
  });

  it('detects Mastercard no spaces', () => {
    expect(hasType('5500005555555559', 'CREDIT_CARD')).toBe(true);
  });

  it('rejects Luhn-invalid number', () => {
    // 4111 1111 1111 1112 — last digit wrong
    expect(hasType('4111 1111 1111 1112', 'CREDIT_CARD')).toBe(false);
  });

  it('does not flag short number', () => {
    expect(hasType('12345', 'CREDIT_CARD')).toBe(false);
  });
});

// ── IBAN ──────────────────────────────────────────────────────────────────────

describe('IBAN_CODE', () => {
  it('detects French IBAN', () => {
    expect(hasType('FR76 3000 6000 0112 3456 7890 189', 'IBAN_CODE')).toBe(true);
  });

  it('detects German IBAN', () => {
    expect(hasType('DE89370400440532013000', 'IBAN_CODE')).toBe(true);
  });
});

// ── SSN ───────────────────────────────────────────────────────────────────────

describe('SSN', () => {
  it('detects standard format', () => {
    expect(hasType('SSN is 123-45-6789', 'SSN')).toBe(true);
  });

  it('detects space-separated', () => {
    expect(hasType('my ssn: 123 45 6789', 'SSN')).toBe(true);
  });
});

// ── IP address ────────────────────────────────────────────────────────────────

describe('IP_ADDRESS', () => {
  it('detects IPv4', () => {
    expect(hasType('server at 192.168.1.1 is down', 'IP_ADDRESS')).toBe(true);
  });

  it('detects another valid IPv4', () => {
    expect(hasType('10.0.0.1', 'IP_ADDRESS')).toBe(true);
  });

  it('does not flag 999.999.999.999', () => {
    // 999 > 255 — not a valid octet
    expect(hasType('999.999.999.999', 'IP_ADDRESS')).toBe(false);
  });
});

// ── Crypto ────────────────────────────────────────────────────────────────────

describe('CRYPTO', () => {
  it('detects Ethereum address', () => {
    expect(hasType('send to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e', 'CRYPTO')).toBe(true);
  });

  it('detects Bitcoin P2PKH', () => {
    expect(hasType('1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf', 'CRYPTO')).toBe(true);
  });
});

// ── Secret keys ───────────────────────────────────────────────────────────────

describe('SECRET_KEY', () => {
  it('detects Bearer token', () => {
    expect(hasType('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz', 'SECRET_KEY')).toBe(true);
  });

  it('detects OpenAI sk- key', () => {
    expect(hasType('key=sk-abcdefghijklmnopqrstuvwx', 'SECRET_KEY')).toBe(true);
  });

  it('detects GitHub PAT', () => {
    expect(hasType('ghp_' + 'A'.repeat(36), 'SECRET_KEY')).toBe(true);
  });

  it('detects password field', () => {
    expect(hasType('password: s3cr3tP@ssw0rd!', 'SECRET_KEY')).toBe(true);
  });
});

// ── Date of birth ─────────────────────────────────────────────────────────────

describe('DATE_OF_BIRTH', () => {
  it('detects DOB label + date', () => {
    expect(hasType('DOB: 01/15/1985', 'DATE_OF_BIRTH')).toBe(true);
  });

  it('detects "date of birth" label', () => {
    expect(hasType('date of birth: 1990-04-22', 'DATE_OF_BIRTH')).toBe(true);
  });

  it('does not flag bare date without label', () => {
    expect(hasType('meeting on 01/15/2025', 'DATE_OF_BIRTH')).toBe(false);
  });
});

// ── Span correctness ──────────────────────────────────────────────────────────

describe('span offsets', () => {
  it('start/end indices correctly slice the value', () => {
    const text = 'send email to alice@example.com thanks';
    for (const d of detectRegex(text)) {
      expect(text.slice(d.start, d.end)).toBe(d.value);
    }
  });

  it('multiple entities in one string', () => {
    const text = 'email alice@x.com phone (555) 123-4567';
    const t = types(text);
    expect(t).toContain('EMAIL_ADDRESS');
    expect(t).toContain('PHONE_NUMBER');
  });
});
