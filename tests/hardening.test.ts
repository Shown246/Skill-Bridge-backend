import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
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
const originalDebug = process.env.DEBUG;

describe('hardening configuration', () => {
  let env: typeof import('../src/config/env.js').env;
  let app: typeof import('../src/app.js').app;
  let logger: typeof import('../src/shared/logging/logger.js').logger;

  beforeAll(async () => {
    Object.assign(process.env, hardeningEnv);
    ({ env } = await import('../src/config/env.js'));
    ({ logger } = await import('../src/shared/logging/logger.js'));
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
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
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

    expect((await request(app).get('/API/AUTH/TOKEN')).status).toBe(429);
    expect((await request(app).get('/api/auth/token/')).status).toBe(429);
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
    expect((await request(app).post('/API/V1/BOOKINGS').send({})).status).toBe(429);
    expect((await request(app).post('/api/v1/bookings/').send({})).status).toBe(429);
    expect(
      (
        await request(app)
          .post('/api/v1/bookings/00000000-0000-0000-0000-000000000000/review/')
          .send({})
      ).status
    ).toBe(429);
  });

  it('rate limits ordinary business traffic without limiting health checks', async () => {
    for (let requestNumber = 0; requestNumber < 4; requestNumber += 1) {
      await request(app).get('/api/v1/not-a-real-route');
    }

    const blocked = await request(app).get('/api/v1/not-a-real-route');
    const health = await request(app).get('/health');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect((await request(app).get('/API/V1/NOT-A-REAL-ROUTE')).status).toBe(429);
    expect(health.status).toBe(200);
  });

  it('redacts nested credentials and sensitive custom error properties', () => {
    process.env.DEBUG = '1';
    const infoSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const customError = Object.assign(new Error('Credential audit failed'), {
      refreshToken: 'error-refresh-token',
      sessionId: 'error-session-id',
    });
    const credentialMessageError = new Error(
      'Authorization: Bearer message-token password=message-password'
    );

    logger.info('credential audit', {
      password: 'plain-password',
      nested: {
        accessToken: 'access-token-value',
        Authorization: 'Bearer bearer-value',
        cookie: 'session=cookie-value',
        apiKey: 'api-key-value',
        sessionId: 'context-session-id',
      },
    });
    logger.error('credential error audit', customError);
    logger.error(
      'Authorization: Bearer top-level-token',
      credentialMessageError
    );

    const infoOutput = String(infoSpy.mock.calls[0]?.[0]);
    const errorOutput = String(errorSpy.mock.calls[0]?.[0]);
    const messageErrorOutput = String(errorSpy.mock.calls[1]?.[0]);
    const combinedOutput = `${infoOutput}\n${errorOutput}\n${messageErrorOutput}`;
    const errorEntry = JSON.parse(errorOutput) as {
      error: Record<string, unknown>;
    };

    for (const secret of [
      'plain-password',
      'access-token-value',
      'bearer-value',
      'cookie-value',
      'api-key-value',
      'context-session-id',
      'error-refresh-token',
      'error-session-id',
      'message-token',
      'message-password',
      'top-level-token',
    ]) {
      expect(combinedOutput).not.toContain(secret);
    }
    expect(errorEntry.error.refreshToken).toBe('[REDACTED]');
    expect(errorEntry.error.sessionId).toBe('[REDACTED]');

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs request paths without raw query credentials', async () => {
    process.env.DEBUG = '1';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await request(app).get('/health?token=query-secret');

    const requestLog = logSpy.mock.calls
      .map(([entry]) => String(entry))
      .find((entry) => entry.includes('"method":"GET"'));

    expect(requestLog).toBeDefined();
    expect(requestLog).not.toContain('query-secret');
    expect(JSON.parse(requestLog!).context.path).toBe('/health');

    logSpy.mockRestore();
  });
});
