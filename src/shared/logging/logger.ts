import { env } from '../../config/env.js';

const REDACT_KEYS = ['password', 'token', 'secret', 'authorization', 'cookie', 'jwt', 'apikey'];

function redact(obj: any, visited = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Error) {
    return {
      message: obj.message,
      stack: obj.stack,
    };
  }
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date || obj instanceof RegExp) return obj;
  if (visited.has(obj)) return '[Circular]';
  visited.add(obj);

  if (Array.isArray(obj)) return obj.map((item) => redact(item, visited));

  const redacted: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (REDACT_KEYS.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redact(obj[key], visited);
    }
  }
  return redacted;
}

export const logger = {
  info(message: string, context?: Record<string, any>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.log(JSON.stringify(logEntry));
  },

  warn(message: string, context?: Record<string, any>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.warn(JSON.stringify(logEntry));
  },

  error(message: string, error?: Error | unknown, context?: Record<string, any>) {
    const errorObj = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : error;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      ...(errorObj ? { error: redact(errorObj) } : {}),
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.error(JSON.stringify(logEntry));
  },

  debug(message: string, context?: Record<string, any>) {
    if (env.NODE_ENV === 'production') return;
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.debug(JSON.stringify(logEntry));
  },
};

export default logger;
