import { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Never leak stack traces in production
  const isDev = process.env.NODE_ENV === 'development';
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';

  console.error(`[${new Date().toISOString()}] ${code}: ${err.message}${isDev ? '\n' + err.stack : ''}`);

  res.status(statusCode).json({
    error: code,
    message: statusCode === 500 && !isDev
      ? 'An unexpected error occurred. Please try again.'
      : err.message,
    ...(isDev && statusCode === 500 ? { stack: err.stack } : {}),
  });
}

export function createError(message: string, statusCode: number, code: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  err.code = code;
  err.isOperational = true;
  return err;
}
