import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/app-error.js';
import { logger } from '../shared/logging/logger.js';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = req.requestId || 'unknown';
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred.';
  let fieldErrors: Record<string, string[] | undefined> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    fieldErrors = err.fieldErrors;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed.';
    fieldErrors = err.flatten().fieldErrors;
  } else if (
    (err instanceof SyntaxError && 'status' in err && (err as any).status === 400) ||
    (err && typeof err === 'object' && (err as any).type === 'entity.parse.failed')
  ) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body.';
  } else if (err && typeof err === 'object' && typeof err.code === 'string') {
    // Prisma client errors
    if (err.code === 'P2002') {
      statusCode = 409;
      code = 'CONFLICT';
      const targetsRaw = err.meta?.target;
      const targets = Array.isArray(targetsRaw)
        ? targetsRaw
        : typeof targetsRaw === 'string'
          ? [targetsRaw]
          : [];
      message = targets.length > 0
        ? `A record with this ${targets.join(', ')} already exists.`
        : 'Unique constraint failed.';
      if (targets.length > 0) {
        fieldErrors = {};
        for (const target of targets) {
          fieldErrors[target] = [`This ${target} is already taken.`];
        }
      }
    } else if (err.code === 'P2025') {
      statusCode = 404;
      code = 'NOT_FOUND';
      message = (err.meta?.cause as string) || 'Record not found.';
    } else if (err.code === 'P2003') {
      statusCode = 409;
      code = 'FOREIGN_KEY_VIOLATION';
      message = 'A relation constraint was violated.';
    }
  }

  // Log the error
  if (statusCode >= 500) {
    logger.error(`Unexpected error on ${req.method} ${req.path}`, err, { requestId });
  } else {
    logger.warn(`Client error on ${req.method} ${req.path}: ${message}`, {
      requestId,
      statusCode,
      code,
      fieldErrors,
    });
  }

  // Respond with standard error envelope
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
    requestId,
  });
};

export default errorHandler;
