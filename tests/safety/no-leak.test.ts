/**
 * Safety regression tests — no-leak assertions.
 *
 * These tests verify that known PII strings are NEVER present in the scrubbed
 * output that would be "sent" to an AI provider.
 *
 * This is the most critical test suite — if any test here fails, the extension
 * is leaking PII. All tests in this file must pass before any release.
 */

import { describe, it, expect } from 'bun:test';
import { detectRegex } from '../../lib/detection/regex';
import { BrowserMapping } from '../../lib/mapping';

function scrubText(text: string): string {
  const detections = detectRegex(text);
  const mapping = new BrowserMapping();
  return mapping.scrub(text, detections);
}

// ── No-leak assertions ────────────────────────────────────────────────────────

describe('No-leak: scrubbed output must not contain raw PII', () => {

  it('email address is scrubbed', () => {
    const email = 'alice@secretcorp.com';
    const scrubbed = scrubText(`Hi, my email is ${email} please reach out`);
    expect(scrubbed).not.toContain(email);
    expect(scrubbed).toContain('<EMAIL_ADDRESS_');
  });

  it('phone number is scrubbed', () => {
    const phone = '(555) 867-5309';
    const scrubbed = scrubText(`Call me at ${phone} anytime`);
    expect(scrubbed).not.toContain(phone);
    expect(scrubbed).toContain('<PHONE_NUMBER_');
  });

  it('credit card number is scrubbed', () => {
    const card = '4111 1111 1111 1111';
    const scrubbed = scrubText(`Please charge card ${card}`);
    expect(scrubbed).not.toContain(card.replace(/\s/g, ''));
    expect(scrubbed).toContain('<CREDIT_CARD_');
  });

  it('SSN is scrubbed', () => {
    const ssn = '123-45-6789';
    const scrubbed = scrubText(`My SSN is ${ssn}`);
    expect(scrubbed).not.toContain(ssn);
    expect(scrubbed).toContain('<SSN_');
  });

  it('IBAN is scrubbed', () => {
    const iban = 'DE89370400440532013000';
    const scrubbed = scrubText(`IBAN: ${iban}`);
    expect(scrubbed).not.toContain(iban);
    expect(scrubbed).toContain('<IBAN_CODE_');
  });

  it('IP address is scrubbed', () => {
    const ip = '192.168.1.100';
    const scrubbed = scrubText(`connect to ${ip} port 22`);
    expect(scrubbed).not.toContain(ip);
    expect(scrubbed).toContain('<IP_ADDRESS_');
  });

  it('Ethereum address is scrubbed', () => {
    const eth = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
    const scrubbed = scrubText(`send ETH to ${eth}`);
    expect(scrubbed.toLowerCase()).not.toContain(eth.toLowerCase());
    expect(scrubbed).toContain('<CRYPTO_');
  });

  it('Bearer token is scrubbed', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const scrubbed = scrubText(`Authorization: Bearer ${token}`);
    expect(scrubbed).not.toContain(token);
    expect(scrubbed).toContain('<SECRET_KEY_');
  });

  it('OpenAI API key is scrubbed', () => {
    const key = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const scrubbed = scrubText(`key=${key}`);
    expect(scrubbed).not.toContain(key);
    expect(scrubbed).toContain('<SECRET_KEY_');
  });

  it('multiple PII items in one message — all scrubbed', () => {
    const email = 'bob@corp.com';
    const phone = '+14155552671';
    const text = `Contact bob@corp.com or call ${phone}`;
    const scrubbed = scrubText(text);
    expect(scrubbed).not.toContain(email);
    expect(scrubbed).not.toContain(phone);
    expect(scrubbed).toContain('<EMAIL_ADDRESS_');
    expect(scrubbed).toContain('<PHONE_NUMBER_');
  });

  it('repeated PII in message — all occurrences scrubbed', () => {
    const email = 'dup@example.com';
    // Build text with two separate detectable emails
    const text = `first ${email} then second contact@other.org`;
    const scrubbed = scrubText(text);
    expect(scrubbed).not.toContain(email);
    expect(scrubbed).not.toContain('contact@other.org');
  });

  it('non-PII text is preserved after scrub', () => {
    const text = 'Hello! My email is x@y.com. The weather is nice today.';
    const scrubbed = scrubText(text);
    expect(scrubbed).toContain('Hello!');
    expect(scrubbed).toContain('The weather is nice today.');
  });

  it('empty string produces no tokens', () => {
    const scrubbed = scrubText('');
    expect(scrubbed).toBe('');
  });

  it('pure non-PII text is unchanged', () => {
    const text = 'Can you explain how neural networks work?';
    const scrubbed = scrubText(text);
    expect(scrubbed).toBe(text);
  });
});

// ── Round-trip invariant ───────────────────────────────────────────────────────

describe('Round-trip: restore(scrub(text)) === original', () => {
  function roundTrip(text: string): string {
    const detections = detectRegex(text);
    const mapping = new BrowserMapping();
    const scrubbed = mapping.scrub(text, detections);
    return mapping.restore(scrubbed);
  }

  it('email round-trips', () => {
    const t = 'email: alice@example.com';
    expect(roundTrip(t)).toBe(t);
  });

  it('SSN round-trips', () => {
    const t = 'SSN is 123-45-6789 here';
    expect(roundTrip(t)).toBe(t);
  });

  it('credit card round-trips', () => {
    const t = 'card 4111 1111 1111 1111 thanks';
    expect(roundTrip(t)).toBe(t);
  });

  it('multiple entities round-trip', () => {
    const t = 'email alice@x.com, phone (555) 123-4567';
    expect(roundTrip(t)).toBe(t);
  });

  it('no-PII text round-trips unchanged', () => {
    const t = 'what is the capital of France?';
    expect(roundTrip(t)).toBe(t);
  });
});
