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
const KNOWN_SECRET_VALUES = [
  env.BETTER_AUTH_SECRET,
  env.JWT_SECRET,
  env.ADMIN_PASSWORD,
].filter((value): value is string => typeof value === 'string' && value.length >= 8);

function sanitizeString(value: string): string {
  let sanitized = value
    .replace(/\b(Bearer)\s+[^\s,;"']+/gi, '$1 [REDACTED]')
    .replace(
      /\b(password|token|secret|authorization|cookie|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi,
      '$1[REDACTED]@'
    );

  for (const secret of KNOWN_SECRET_VALUES) {
    sanitized = sanitized.replaceAll(secret, '[REDACTED]');
  }
  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalizedKey.includes(part));
}

function redact(value: unknown, visited = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
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
    redacted.message = sanitizeString(value.message);
    redacted.stack = value.stack ? sanitizeString(value.stack) : value.stack;
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
      message: sanitizeString(message),
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.log(JSON.stringify(logEntry));
  },

  warn(message: string, context?: Record<string, unknown>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message: sanitizeString(message),
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.warn(JSON.stringify(logEntry));
  },

  error(message: string, error?: unknown, context?: Record<string, unknown>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: sanitizeString(message),
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
      message: sanitizeString(message),
      ...(context ? { context: redact(context) } : {}),
    };
    if (env.NODE_ENV === 'test' && !process.env.DEBUG) return;
    console.debug(JSON.stringify(logEntry));
  },
};

export default logger;
