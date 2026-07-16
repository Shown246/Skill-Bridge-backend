import { env } from '../../config/env.js';

const SENSITIVE_KEY_PARTS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'session',
  'jwt',
  'apikey',
];

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalizedKey.includes(part));
}

function redact(value: unknown, visited = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date || value instanceof RegExp) return value;
  if (visited.has(value)) return '[Circular]';
  visited.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, visited));
  }

  const redacted: Record<string, unknown> = {};
  if (value instanceof Error) {
    redacted.name = value.name;
    redacted.message = value.message;
    redacted.stack = value.stack;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redact(nestedValue, visited);
    }
  }
  return redacted;
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.log(JSON.stringify(logEntry));
  },

  warn(message: string, context?: Record<string, unknown>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.warn(JSON.stringify(logEntry));
  },

  error(message: string, error?: unknown, context?: Record<string, unknown>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      ...(error ? { error: redact(error) } : {}),
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.error(JSON.stringify(logEntry));
  },

  debug(message: string, context?: Record<string, unknown>) {
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
