import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; displayName: string; role: string };
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  try {
    // Accept from Authorization header OR httpOnly cookie
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies?.fq_token) {
      token = req.cookies.fq_token;
    }

    if (!token) {
      return next(createError('Authentication required.', 401, 'UNAUTHENTICATED'));
    }

    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string; email: string; displayName: string; role: string;
    };

    req.user = {
      id:          payload.sub,
      email:       payload.email,
      displayName: payload.displayName,
      role:        payload.role,
    };

    next();
  } catch {
    next(createError('Invalid or expired token.', 401, 'UNAUTHENTICATED'));
  }
}

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    return next(createError('Admin access required.', 403, 'FORBIDDEN'));
  }
  next();
}

export function signToken(payload: { sub: string; email: string; displayName: string; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
}
