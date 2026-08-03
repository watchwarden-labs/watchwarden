import { describe, expect, it } from 'vitest';
import { closeSql, initSql } from '../client.js';

describe('initSql', () => {
  it('throws a clear, actionable error when DATABASE_URL contains an unescaped special character', async () => {
    // postgres.js parses the connection string with `new URL()` — a raw `/` in the
    // password breaks URL parsing and throws a bare "TypeError: Invalid URL".
    expect(() => initSql('postgresql://watchwarden:pa/ss@localhost:5432/watchwarden')).toThrow(
      /DATABASE_URL is not a valid connection string.*POSTGRES_PASSWORD.*openssl rand -hex 32/s,
    );
  });

  it('throws the required-env-var error when no connection string is available', () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => initSql()).toThrow('DATABASE_URL environment variable is required');
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });

  it('initializes normally for a well-formed connection string', async () => {
    const client = initSql('postgresql://watchwarden:watchwarden@localhost:5432/watchwarden');
    expect(client).toBeDefined();
    await closeSql();
  });
});
