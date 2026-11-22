import { NextFunction, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { AgeGroup, SupportedLanguage, UserRole } from '../../shared/schemas.ts';
import { isDatabaseConfigured, queryRows } from '../db/pool.ts';
import { sha256Hex } from '../utils/crypto.ts';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.ts';
import { SESSION_COOKIE_NAME } from './security.ts';

export interface AuthenticatedUser {
  id: number;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: 'active' | 'suspended' | 'pending_verification';
  ageGroup: AgeGroup;
  preferredLanguage: SupportedLanguage;
  contactVerified: boolean;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: number;
    }
  }
}

export async function resolveSessionUser(token: string): Promise<{
  user: AuthenticatedUser;
  sessionId: number;
} | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const tokenHash = sha256Hex(token);
  const rows = await queryRows<RowDataPacket[]>(
    `SELECT
       s.id AS session_id,
       u.id,
       u.email,
       u.phone,
       u.role,
       u.status,
       u.age_group,
       u.preferred_language,
       u.contact_verified,
       p.display_name,
       p.username,
       p.avatar_url,
       p.total_xp,
       p.current_level,
       p.current_streak
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  if (row.status === 'suspended') {
    return null;
  }

  return {
    sessionId: Number(row.session_id),
    user: {
      id: Number(row.id),
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      role: row.role as UserRole,
      status: row.status,
      ageGroup: row.age_group as AgeGroup,
      preferredLanguage: row.preferred_language as SupportedLanguage,
      contactVerified: Boolean(row.contact_verified),
      displayName: String(row.display_name),
      username: String(row.username),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      totalXp: Number(row.total_xp),
      currentLevel: Number(row.current_level),
      currentStreak: Number(row.current_streak),
    },
  };
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token && typeof token === 'string') {
      const resolved = await resolveSessionUser(token);
      if (resolved) {
        req.user = resolved.user;
        req.sessionId = resolved.sessionId;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export async function authenticateSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token || typeof token !== 'string') {
      next(new UnauthorizedError('Please sign in to continue'));
      return;
    }
    const resolved = await resolveSessionUser(token);
    if (!resolved) {
      next(new UnauthorizedError('Your session has expired. Please sign in again.'));
      return;
    }
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError('Insufficient permissions for this administrative resource'));
      return;
    }
    next();
  };
}
