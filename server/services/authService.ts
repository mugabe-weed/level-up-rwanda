import { RowDataPacket } from 'mysql2/promise';
import { AgeGroup, SupportedLanguage } from '../../shared/schemas.ts';
import { appConfig } from '../config.ts';
import { queryRows, withTransaction } from '../db/pool.ts';
import {
  generateSecureToken,
  generateVerificationCode,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../utils/crypto.ts';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/errors.ts';
import { recordAuditLog } from './auditService.ts';

export async function registerUser(params: {
  email?: string;
  phone?: string;
  displayName: string;
  username: string;
  password: string;
  ageGroup: AgeGroup;
  preferredLanguage: SupportedLanguage;
  district?: string;
  ipAddress?: string;
}) {
  const email = params.email ? params.email.trim().toLowerCase() : null;
  const phone = params.phone ? params.phone.trim() : null;
  const username = params.username.trim().toLowerCase();

  const passwordHash = await hashPassword(params.password);
  const verificationCode = generateVerificationCode();
  const verificationCodeHash = sha256Hex(verificationCode);

  const userId = await withTransaction(async (conn) => {
    const [regSetting] = await conn.execute<RowDataPacket[]>(
      "SELECT setting_value_json FROM platform_settings WHERE setting_key = 'registration_open' LIMIT 1",
    );
    if (regSetting.length > 0) {
      const val =
        typeof regSetting[0].setting_value_json === 'string'
          ? JSON.parse(regSetting[0].setting_value_json)
          : regSetting[0].setting_value_json;
      if (val && val.enabled === false) {
        throw new ForbiddenError('New registrations are currently paused by an administrator.');
      }
    }

    if (email) {
      const [dupEmail] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      if (dupEmail.length > 0) {
        throw new ConflictError('An account with this email address already exists.');
      }
    }

    if (phone) {
      const [dupPhone] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE phone = ? LIMIT 1',
        [phone],
      );
      if (dupPhone.length > 0) {
        throw new ConflictError('An account with this phone number already exists.');
      }
    }

    const [dupUsername] = await conn.execute<RowDataPacket[]>(
      'SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1',
      [username],
    );
    if (dupUsername.length > 0) {
      throw new ConflictError('This username is already taken.');
    }

    const [userRes] = await conn.execute<any>(
      `INSERT INTO users
        (email, phone, password_hash, role, status, age_group, preferred_language, contact_verified, contact_verification_token_hash, contact_verification_expires_at)
       VALUES (?, ?, ?, 'member', 'active', ?, ?, 0, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [email, phone, passwordHash, params.ageGroup, params.preferredLanguage, verificationCodeHash],
    );
    const createdUserId = Number(userRes.insertId);

    await conn.execute(
      `INSERT INTO user_profiles
        (user_id, display_name, username, district, interests_json, skills_json, profile_visibility)
       VALUES (?, ?, ?, ?, CAST('[]' AS JSON), CAST('[]' AS JSON), 'community')`,
      [createdUserId, params.displayName.trim(), username, params.district?.trim() || null],
    );

    await conn.execute(
      'INSERT INTO notification_preferences (user_id) VALUES (?)',
      [createdUserId],
    );

    await conn.execute(
      `INSERT INTO notifications (user_id, type, title_text, body_text, link_url)
       VALUES (?, 'welcome', 'Welcome to LEVELUP RWANDA', 'Verify your contact details and try today’s Daily Challenge to earn your first XP.', '/play')`,
      [createdUserId],
    );

    await recordAuditLog({
      actorUserId: createdUserId,
      action: 'USER_REGISTERED',
      targetType: 'user',
      targetId: createdUserId,
      metadata: { ageGroup: params.ageGroup, preferredLanguage: params.preferredLanguage },
      ipAddress: params.ipAddress,
      conn,
    });

    return createdUserId;
  });

  return {
    userId,
    verificationPreviewCode: appConfig.isProduction ? undefined : verificationCode,
  };
}

export async function loginUser(params: {
  identifier: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const idLower = params.identifier.trim().toLowerCase();

  const rows = await queryRows<RowDataPacket[]>(
    `SELECT u.*, p.username, p.display_name
     FROM users u
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = ? OR u.phone = ? OR p.username = ?
     LIMIT 1`,
    [idLower, params.identifier.trim(), idLower],
  );

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid credentials.');
  }

  const user = rows[0];
  if (user.status === 'suspended') {
    throw new ForbiddenError('This account has been suspended. Contact support for assistance.');
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new ForbiddenError('Too many failed sign-in attempts. Please wait 15 minutes before trying again.');
  }

  const valid = await verifyPassword(params.password, String(user.password_hash));
  if (!valid) {
    await withTransaction(async (conn) => {
      const nextAttempts = Number(user.failed_login_attempts || 0) + 1;
      const shouldLock = nextAttempts >= 5;
      await conn.execute(
        `UPDATE users
         SET failed_login_attempts = ?,
             locked_until = ${shouldLock ? 'DATE_ADD(NOW(), INTERVAL 15 MINUTE)' : 'NULL'}
         WHERE id = ?`,
        [nextAttempts, user.id],
      );
      await recordAuditLog({
        actorUserId: Number(user.id),
        action: 'LOGIN_FAILED',
        targetType: 'user',
        targetId: Number(user.id),
        metadata: { attempts: nextAttempts, locked: shouldLock },
        ipAddress: params.ipAddress,
        conn,
      });
    });
    throw new UnauthorizedError('Invalid credentials.');
  }

  const rawSessionToken = generateSecureToken(32);
  const tokenHash = sha256Hex(rawSessionToken);

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE users
       SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
       WHERE id = ?`,
      [user.id],
    );
    await conn.execute(
      `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [
        user.id,
        tokenHash,
        params.ipAddress?.slice(0, 64) || null,
        params.userAgent?.slice(0, 255) || null,
        appConfig.sessionTtlHours,
      ],
    );
    await recordAuditLog({
      actorUserId: Number(user.id),
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: Number(user.id),
      ipAddress: params.ipAddress,
      conn,
    });
  });

  return {
    sessionToken: rawSessionToken,
    userId: Number(user.id),
  };
}

export async function logoutSession(sessionId: number, userId: number, ipAddress?: string): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE id = ?', [sessionId]);
    await recordAuditLog({
      actorUserId: userId,
      action: 'LOGOUT',
      targetType: 'session',
      targetId: sessionId,
      ipAddress,
      conn,
    });
  });
}

export async function verifyUserContact(identifier: string, code: string): Promise<void> {
  const idLower = identifier.trim().toLowerCase();
  const codeHash = sha256Hex(code.trim());

  await withTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT u.id, u.contact_verification_token_hash, u.contact_verification_expires_at
       FROM users u
       INNER JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = ? OR u.phone = ? OR p.username = ?
       LIMIT 1`,
      [idLower, identifier.trim(), idLower],
    );
    if (rows.length === 0) {
      throw new NotFoundError('Account not found.');
    }
    const user = rows[0];
    if (
      !user.contact_verification_token_hash ||
      user.contact_verification_token_hash !== codeHash ||
      !user.contact_verification_expires_at ||
      new Date(user.contact_verification_expires_at).getTime() < Date.now()
    ) {
      throw new ValidationError('Invalid or expired verification code.');
    }

    await conn.execute(
      `UPDATE users
       SET contact_verified = 1,
           contact_verification_token_hash = NULL,
           contact_verification_expires_at = NULL
       WHERE id = ?`,
      [user.id],
    );
  });
}

export async function requestPasswordReset(identifier: string, ipAddress?: string) {
  const idLower = identifier.trim().toLowerCase();
  const resetToken = generateVerificationCode();
  const resetHash = sha256Hex(resetToken);

  const rows = await queryRows<RowDataPacket[]>(
    `SELECT u.id
     FROM users u
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = ? OR u.phone = ? OR p.username = ?
     LIMIT 1`,
    [idLower, identifier.trim(), idLower],
  );

  if (rows.length === 0) {
    return { requested: true };
  }

  const userId = Number(rows[0].id);
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE users
       SET password_reset_token_hash = ?, password_reset_expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
       WHERE id = ?`,
      [resetHash, userId],
    );
    await recordAuditLog({
      actorUserId: userId,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'user',
      targetId: userId,
      ipAddress,
      conn,
    });
  });

  return {
    requested: true,
    resetPreviewCode: appConfig.isProduction ? undefined : resetToken,
  };
}

export async function confirmPasswordReset(params: {
  identifier: string;
  token: string;
  newPassword: string;
  ipAddress?: string;
}) {
  const idLower = params.identifier.trim().toLowerCase();
  const tokenHash = sha256Hex(params.token.trim());
  const newPasswordHash = await hashPassword(params.newPassword);

  await withTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT u.id, u.password_reset_token_hash, u.password_reset_expires_at
       FROM users u
       INNER JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = ? OR u.phone = ? OR p.username = ?
       LIMIT 1`,
      [idLower, params.identifier.trim(), idLower],
    );

    if (rows.length === 0) {
      throw new ValidationError('Invalid reset request.');
    }

    const user = rows[0];
    if (
      !user.password_reset_token_hash ||
      user.password_reset_token_hash !== tokenHash ||
      !user.password_reset_expires_at ||
      new Date(user.password_reset_expires_at).getTime() < Date.now()
    ) {
      throw new ValidationError('Invalid or expired password reset code.');
    }

    await conn.execute(
      `UPDATE users
       SET password_hash = ?,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           failed_login_attempts = 0,
           locked_until = NULL
       WHERE id = ?`,
      [newPasswordHash, user.id],
    );

    // Revoke all active sessions on password reset
    await conn.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ?', [user.id]);

    await recordAuditLog({
      actorUserId: Number(user.id),
      action: 'PASSWORD_RESET_COMPLETED',
      targetType: 'user',
      targetId: Number(user.id),
      ipAddress: params.ipAddress,
      conn,
    });
  });
}

export async function hasAnySuperAdmin(): Promise<boolean> {
  const rows = await queryRows<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1",
  );
  return rows.length > 0;
}
