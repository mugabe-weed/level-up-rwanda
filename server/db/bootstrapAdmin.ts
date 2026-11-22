import { RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '../utils/crypto.ts';
import { withTransaction } from './pool.ts';

export interface BootstrapAdminParams {
  email: string;
  displayName: string;
  username: string;
  password: string;
  ipAddress?: string;
}

export async function provisionFirstSuperAdmin(params: BootstrapAdminParams): Promise<{
  userId: number;
  email: string;
  username: string;
}> {
  const passwordHash = await hashPassword(params.password);

  return withTransaction(async (conn) => {
    const [existingAdmins] = await conn.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1",
    );
    if (existingAdmins.length > 0) {
      throw new Error('A super_admin account has already been provisioned.');
    }

    const [dupEmail] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [params.email.toLowerCase()],
    );
    if (dupEmail.length > 0) {
      throw new Error('Email is already registered.');
    }

    const [dupUser] = await conn.execute<RowDataPacket[]>(
      'SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1',
      [params.username.toLowerCase()],
    );
    if (dupUser.length > 0) {
      throw new Error('Username is already taken.');
    }

    const [userRes] = await conn.execute<any>(
      `INSERT INTO users
        (email, password_hash, role, status, age_group, preferred_language, contact_verified)
       VALUES (?, ?, 'super_admin', 'active', 'adult_18_plus', 'en', 1)`,
      [params.email.toLowerCase(), passwordHash],
    );
    const userId = Number(userRes.insertId);

    await conn.execute(
      `INSERT INTO user_profiles
        (user_id, display_name, username, interests_json, skills_json, profile_visibility)
       VALUES (?, ?, ?, CAST('[]' AS JSON), CAST('[]' AS JSON), 'community')`,
      [userId, params.displayName, params.username.toLowerCase()],
    );

    await conn.execute(
      'INSERT INTO notification_preferences (user_id) VALUES (?)',
      [userId],
    );

    await conn.execute(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata_json, ip_address)
       VALUES (?, 'SUPER_ADMIN_PROVISIONED', 'user', ?, CAST(? AS JSON), ?)`,
      [
        userId,
        String(userId),
        JSON.stringify({ email: params.email.toLowerCase(), username: params.username.toLowerCase() }),
        params.ipAddress || 'cli',
      ],
    );

    return {
      userId,
      email: params.email.toLowerCase(),
      username: params.username.toLowerCase(),
    };
  });
}
