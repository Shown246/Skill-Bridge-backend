import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import request from 'supertest';

const mockQueryRaw = jest.fn() as any;

jest.mock('@prisma/client', () => {
  return {
    __esModule: true,
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        $queryRaw: mockQueryRaw,
        $disconnect: jest.fn(),
      };
    }),
  };
});

describe('Health & Readiness Endpoints', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return 200 with UP status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          status: 'UP',
          timestamp: expect.any(String),
        },
        requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
      });
    });
  });

  describe('GET /ready', () => {
    it('should return 200 and READY status when db is connected', async () => {
      mockQueryRaw.mockResolvedValue([{ 1: 1 }]);

      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          status: 'READY',
          database: 'CONNECTED',
          timestamp: expect.any(String),
        },
        requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
      });
      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should return 503 and DATABASE_UNAVAILABLE when db is down', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed.',
        },
        requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
      });
    });
  });
});
