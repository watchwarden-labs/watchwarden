import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, initCrypto, resetKey } from '../crypto.js';

describe('crypto (SEC-01)', () => {
  const TEST_SALT = 'test-salt-at-least-16-chars-long';

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'my-super-secret-key-for-testing';
    initCrypto(TEST_SALT);
  });

  afterEach(() => {
    resetKey();
    delete process.env.ENCRYPTION_KEY;
  });

  it('encrypted output contains a 12-byte IV as the first segment', () => {
    const ciphertext = encrypt('hello world');
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);

    const ivBytes = Buffer.from(parts[0]!, 'base64');
    expect(ivBytes.length).toBe(12);
  });

  it('encrypt then decrypt round-trips correctly', () => {
    const plaintext = 'test data';
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('decrypt with tampered ciphertext throws', () => {
    const ciphertext = encrypt('sensitive info');
    const parts = ciphertext.split(':');
    // Flip a character in the 3rd segment (encrypted data)
    const encrypted = parts[2]!;
    const flipped = encrypted[0] === 'A' ? `B${encrypted.slice(1)}` : `A${encrypted.slice(1)}`;
    const tampered = `${parts[0]}:${parts[1]}:${flipped}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it('initCrypto rejects missing ENCRYPTION_KEY', () => {
    resetKey();
    delete process.env.ENCRYPTION_KEY;
    expect(() => initCrypto(TEST_SALT)).toThrow('ENCRYPTION_KEY env var is required');
  });
});
