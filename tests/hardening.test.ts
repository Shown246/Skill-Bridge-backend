import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';

const hardeningEnv = {
  AUTH_RATE_LIMIT_WINDOW_MS: '1000',
  AUTH_RATE_LIMIT_MAX: '2',
  SENSITIVE_RATE_LIMIT_WINDOW_MS: '2000',
  SENSITIVE_RATE_LIMIT_MAX: '3',
  GENERAL_RATE_LIMIT_WINDOW_MS: '3000',
  GENERAL_RATE_LIMIT_MAX: '4',
  TRUST_PROXY: '1',
} as const;

const originalEnv = Object.fromEntries(
  Object.keys(hardeningEnv).map((key) => [key, process.env[key]])
);

describe('hardening configuration', () => {
  let env: typeof import('../src/config/env.js').env;

  beforeAll(async () => {
    Object.assign(process.env, hardeningEnv);
    ({ env } = await import('../src/config/env.js'));
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('parses configurable rate limits and trust proxy settings', () => {
    expect(env.AUTH_RATE_LIMIT_WINDOW_MS).toBe(1000);
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(2);
    expect(env.SENSITIVE_RATE_LIMIT_WINDOW_MS).toBe(2000);
    expect(env.SENSITIVE_RATE_LIMIT_MAX).toBe(3);
    expect(env.GENERAL_RATE_LIMIT_WINDOW_MS).toBe(3000);
    expect(env.GENERAL_RATE_LIMIT_MAX).toBe(4);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it.each([
    ['AUTH_RATE_LIMIT_MAX', '0'],
    ['GENERAL_RATE_LIMIT_WINDOW_MS', '-1'],
    ['SENSITIVE_RATE_LIMIT_MAX', '1.5'],
    ['TRUST_PROXY', '-1'],
  ])('fails startup for invalid %s=%s', (key, value) => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '-e', "import('./src/config/env.ts')"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          [key]: value,
        },
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Environment validation failed');
  });
});
