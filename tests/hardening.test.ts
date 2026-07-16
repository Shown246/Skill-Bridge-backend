import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import request from 'supertest';

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
  let app: typeof import('../src/app.js').app;

  beforeAll(async () => {
    Object.assign(process.env, hardeningEnv);
    ({ env } = await import('../src/config/env.js'));
    ({ app } = await import('../src/app.js'));
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

  it('sets Helmet security headers', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('rate limits selected auth routes with a stable error envelope', async () => {
    await request(app).get('/api/auth/token');
    await request(app).get('/api/auth/token');
    const blocked = await request(app).get('/api/auth/token');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
      requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
    });
    expect(blocked.headers).toHaveProperty('ratelimit-policy');
    expect(blocked.headers).not.toHaveProperty('x-ratelimit-limit');
    expect(blocked.headers['x-content-type-options']).toBe('nosniff');

    const separateSignUpBucket = await request(app)
      .post('/api/auth/sign-up/email')
      .send({});
    expect(separateSignUpBucket.status).not.toBe(429);
  });

  it('uses one sensitive quota for booking, review, and admin mutations', async () => {
    await request(app).post('/api/v1/bookings').send({});
    await request(app)
      .post('/api/v1/bookings/00000000-0000-0000-0000-000000000000/review')
      .send({});
    await request(app)
      .patch('/api/v1/admin/users/00000000-0000-0000-0000-000000000000/status')
      .send({});

    const blocked = await request(app).post('/api/v1/bookings').send({});

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers).toHaveProperty('ratelimit-policy');
  });

  it('rate limits ordinary business traffic without limiting health checks', async () => {
    for (let requestNumber = 0; requestNumber < 4; requestNumber += 1) {
      await request(app).get('/api/v1/not-a-real-route');
    }

    const blocked = await request(app).get('/api/v1/not-a-real-route');
    const health = await request(app).get('/health');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(health.status).toBe(200);
  });
});
