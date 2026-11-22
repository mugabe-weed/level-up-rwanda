import { RowDataPacket } from 'mysql2/promise';
import { SupportedLanguage } from '../../shared/schemas.ts';
import { localStore } from '../db/localStore.ts';
import { isDatabaseConfigured, queryRows, withTransaction } from '../db/pool.ts';
import { ForbiddenError, NotFoundError } from '../utils/errors.ts';
import { xpRangeForLevel } from './gamificationService.ts';

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getUserProfileByUsername(username: string, viewerUserId?: number) {
  if (!isDatabaseConfigured()) {
    return localStore.getUserProfileByUsername(username, viewerUserId, xpRangeForLevel);
  }
  const rows = await queryRows<RowDataPacket[]>(
    `SELECT
       u.id, u.role, u.status, u.age_group, u.preferred_language, u.contact_verified, u.created_at,
       p.display_name, p.username, p.avatar_url, p.bio, p.district,
       p.interests_json, p.skills_json, p.profile_visibility, p.show_activity,
       p.total_xp, p.current_level, p.current_streak, p.longest_streak
     FROM users u
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE p.username = ?
     LIMIT 1`,
    [username.toLowerCase()],
  );
  if (rows.length === 0) {
    throw new NotFoundError('User profile not found.');
  }

  const row = rows[0];
  const targetUserId = Number(row.id);
  const isOwner = viewerUserId === targetUserId;

  if (row.profile_visibility === 'private' && !isOwner) {
    throw new ForbiddenError('This profile is private.');
  }
  if (row.profile_visibility === 'community' && !viewerUserId) {
    throw new ForbiddenError('Sign in to view community member profiles.');
  }

  const achievements = await queryRows<RowDataPacket[]>(
    `SELECT a.slug, a.title_en, a.title_rw, a.title_fr, a.description_en, a.description_rw, a.description_fr,
            a.icon_name, a.badge_tier, a.xp_bonus, ua.unlocked_at
     FROM user_achievements ua
     INNER JOIN achievements a ON a.id = ua.achievement_id
     WHERE ua.user_id = ?
     ORDER BY ua.unlocked_at DESC`,
    [targetUserId],
  );

  const showActivity = isOwner || Boolean(row.show_activity);

  const challengeHistory = showActivity
    ? await queryRows<RowDataPacket[]>(
        `SELECT cs.id, cs.score, cs.max_score, cs.correct_count, cs.total_questions, cs.xp_awarded, cs.submitted_at,
                c.slug, c.title_en, c.title_rw, c.title_fr
         FROM challenge_submissions cs
         INNER JOIN challenges c ON c.id = cs.challenge_id
         WHERE cs.user_id = ?
         ORDER BY cs.submitted_at DESC
         LIMIT 20`,
        [targetUserId],
      )
    : [];

  const learningProgress = showActivity
    ? await queryRows<RowDataPacket[]>(
        `SELECT ce.status, ce.progress_percent, ce.enrolled_at, ce.completed_at,
                c.slug, c.title_en, c.title_rw, c.title_fr
         FROM course_enrollments ce
         INNER JOIN courses c ON c.id = ce.course_id
         WHERE ce.user_id = ?
         ORDER BY ce.enrolled_at DESC`,
        [targetUserId],
      )
    : [];

  const xpHistory = isOwner
    ? await queryRows<RowDataPacket[]>(
        `SELECT id, source_type, points, description, created_at
         FROM xp_transactions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 30`,
        [targetUserId],
      )
    : [];

  const savedOpportunities = isOwner
    ? await queryRows<RowDataPacket[]>(
        `SELECT o.id, o.title, o.organization_name, o.opportunity_type, o.location, o.deadline_at, o.application_url
         FROM saved_opportunities so
         INNER JOIN opportunities o ON o.id = so.opportunity_id
         WHERE so.user_id = ?
         ORDER BY so.created_at DESC`,
        [targetUserId],
      )
    : [];

  const blockedUsers = isOwner
    ? await queryRows<RowDataPacket[]>(
        `SELECT ub.blocked_id, up.display_name, up.username, ub.created_at
         FROM user_blocks ub
         INNER JOIN user_profiles up ON up.user_id = ub.blocked_id
         WHERE ub.blocker_id = ?`,
        [targetUserId],
      )
    : [];

  const [followerRow] = await queryRows<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM user_follows WHERE following_id = ?',
    [targetUserId],
  );
  const [followingRow] = await queryRows<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM user_follows WHERE follower_id = ?',
    [targetUserId],
  );

  let isFollowing = false;
  if (viewerUserId && !isOwner) {
    const fRows = await queryRows<RowDataPacket[]>(
      'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
      [viewerUserId, targetUserId],
    );
    isFollowing = fRows.length > 0;
  }

  const levelBounds = xpRangeForLevel(Number(row.current_level));

  return {
    profile: {
      id: targetUserId,
      role: row.role,
      ageGroup: row.age_group,
      preferredLanguage: row.preferred_language,
      contactVerified: Boolean(row.contact_verified),
      createdAt: row.created_at,
      displayName: row.display_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      bio: row.bio || '',
      district: row.district || '',
      interests: parseJsonArray(row.interests_json),
      skills: parseJsonArray(row.skills_json),
      profileVisibility: row.profile_visibility,
      showActivity: Boolean(row.show_activity),
      totalXp: Number(row.total_xp),
      currentLevel: Number(row.current_level),
      currentStreak: Number(row.current_streak),
      longestStreak: Number(row.longest_streak),
      levelProgress: levelBounds,
      followersCount: Number(followerRow?.cnt ?? 0),
      followingCount: Number(followingRow?.cnt ?? 0),
      isFollowing,
      isOwner,
    },
    achievements,
    challengeHistory,
    learningProgress,
    xpHistory,
    savedOpportunities,
    blockedUsers,
  };
}

export async function updateOwnProfile(
  userId: number,
  data: {
    displayName: string;
    bio: string;
    district: string;
    interests: string[];
    skills: string[];
    profileVisibility: 'public' | 'community' | 'private';
    showActivity: boolean;
    preferredLanguage?: SupportedLanguage;
  },
) {
  if (!isDatabaseConfigured()) {
    return localStore.updateOwnProfile(userId, data);
  }
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE user_profiles
       SET display_name = ?, bio = ?, district = ?,
           interests_json = CAST(? AS JSON),
           skills_json = CAST(? AS JSON),
           profile_visibility = ?,
           show_activity = ?
       WHERE user_id = ?`,
      [
        data.displayName,
        data.bio,
        data.district || null,
        JSON.stringify(data.interests),
        JSON.stringify(data.skills),
        data.profileVisibility,
        data.showActivity ? 1 : 0,
        userId,
      ],
    );

    if (data.preferredLanguage) {
      await conn.execute('UPDATE users SET preferred_language = ? WHERE id = ?', [
        data.preferredLanguage,
        userId,
      ]);
    }
  });
}

export async function updateUserAvatar(userId: number, avatarUrl: string) {
  if (!isDatabaseConfigured()) {
    return localStore.updateUserAvatar(userId, avatarUrl);
  }
  await queryRows('UPDATE user_profiles SET avatar_url = ? WHERE user_id = ?', [avatarUrl, userId]);
}

export async function updateUserLanguage(userId: number, language: SupportedLanguage) {
  if (!isDatabaseConfigured()) {
    return localStore.updateUserLanguage(userId, language);
  }
  await queryRows('UPDATE users SET preferred_language = ? WHERE id = ?', [language, userId]);
}
