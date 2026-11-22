import { PoolConnection, RowDataPacket } from 'mysql2/promise';

export function calculateLevelFromXp(totalXp: number): number {
  const safeXp = Math.max(0, totalXp);
  return Math.floor(Math.sqrt(safeXp / 100)) + 1;
}

export function xpRangeForLevel(level: number): { currentLevelMinXp: number; nextLevelMinXp: number } {
  const lvl = Math.max(1, level);
  return {
    currentLevelMinXp: (lvl - 1) * (lvl - 1) * 100,
    nextLevelMinXp: lvl * lvl * 100,
  };
}

export type XpSourceType =
  | 'challenge_completion'
  | 'lesson_completion'
  | 'course_completion'
  | 'community_post'
  | 'achievement_bonus';

export async function awardXpInTransaction(
  conn: PoolConnection,
  params: {
    userId: number;
    sourceType: XpSourceType;
    sourceId: number;
    idempotencyKey: string;
    points: number;
    description: string;
  },
): Promise<{ awarded: boolean; newTotalXp: number; newLevel: number }> {
  if (params.points <= 0) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT total_xp, current_level FROM user_profiles WHERE user_id = ?',
      [params.userId],
    );
    return {
      awarded: false,
      newTotalXp: Number(rows[0]?.total_xp ?? 0),
      newLevel: Number(rows[0]?.current_level ?? 1),
    };
  }

  const [existing] = await conn.execute<RowDataPacket[]>(
    'SELECT id FROM xp_transactions WHERE idempotency_key = ? LIMIT 1',
    [params.idempotencyKey],
  );
  if (existing.length > 0) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT total_xp, current_level FROM user_profiles WHERE user_id = ?',
      [params.userId],
    );
    return {
      awarded: false,
      newTotalXp: Number(rows[0]?.total_xp ?? 0),
      newLevel: Number(rows[0]?.current_level ?? 1),
    };
  }

  await conn.execute(
    `INSERT INTO xp_transactions (user_id, source_type, source_id, idempotency_key, points, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.sourceType,
      params.sourceId,
      params.idempotencyKey,
      params.points,
      params.description,
    ],
  );

  await conn.execute(
    'UPDATE user_profiles SET total_xp = total_xp + ? WHERE user_id = ?',
    [params.points, params.userId],
  );

  const [profileRows] = await conn.execute<RowDataPacket[]>(
    'SELECT total_xp FROM user_profiles WHERE user_id = ?',
    [params.userId],
  );
  const newTotalXp = Number(profileRows[0]?.total_xp ?? 0);
  const newLevel = calculateLevelFromXp(newTotalXp);

  await conn.execute(
    'UPDATE user_profiles SET current_level = ? WHERE user_id = ?',
    [newLevel, params.userId],
  );

  return { awarded: true, newTotalXp, newLevel };
}

export async function updateChallengeStreakInTransaction(
  conn: PoolConnection,
  userId: number,
): Promise<{ currentStreak: number; longestStreak: number }> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT current_streak, longest_streak, last_challenge_date, CURDATE() AS today_date,
            DATEDIFF(CURDATE(), last_challenge_date) AS days_diff
     FROM user_profiles
     WHERE user_id = ?
     FOR UPDATE`,
    [userId],
  );
  if (rows.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const row = rows[0];
  let currentStreak = Number(row.current_streak || 0);
  let longestStreak = Number(row.longest_streak || 0);
  const daysDiff = row.days_diff === null ? null : Number(row.days_diff);

  if (daysDiff === null || daysDiff > 1) {
    currentStreak = 1;
  } else if (daysDiff === 1) {
    currentStreak += 1;
  } else if (daysDiff === 0 && currentStreak === 0) {
    currentStreak = 1;
  }

  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  await conn.execute(
    `UPDATE user_profiles
     SET current_streak = ?, longest_streak = ?, last_challenge_date = CURDATE()
     WHERE user_id = ?`,
    [currentStreak, longestStreak, userId],
  );

  return { currentStreak, longestStreak };
}

export async function evaluateAndUnlockAchievementsInTransaction(
  conn: PoolConnection,
  userId: number,
): Promise<Array<{ slug: string; titleEn: string; xpBonus: number }>> {
  const [profileRows] = await conn.execute<RowDataPacket[]>(
    'SELECT total_xp, current_streak FROM user_profiles WHERE user_id = ?',
    [userId],
  );
  const profile = profileRows[0];
  if (!profile) return [];

  const [[chCountRow]] = await conn.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM challenge_submissions WHERE user_id = ?',
    [userId],
  );
  const [[courseCountRow]] = await conn.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE user_id = ? AND status = 'completed'",
    [userId],
  );
  const [[postCountRow]] = await conn.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM creative_posts WHERE user_id = ? AND moderation_status != 'removed'",
    [userId],
  );

  const metrics: Record<string, number> = {
    challenges_completed: Number(chCountRow?.cnt ?? 0),
    streak_days: Number(profile.current_streak ?? 0),
    courses_completed: Number(courseCountRow?.cnt ?? 0),
    posts_created: Number(postCountRow?.cnt ?? 0),
    total_xp: Number(profile.total_xp ?? 0),
  };

  const [eligible] = await conn.execute<RowDataPacket[]>(
    `SELECT a.*
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
     WHERE a.is_active = 1 AND ua.id IS NULL`,
    [userId],
  );

  const unlocked: Array<{ slug: string; titleEn: string; xpBonus: number }> = [];

  for (const ach of eligible) {
    const metricVal = metrics[String(ach.rule_type)] ?? 0;
    if (metricVal >= Number(ach.rule_threshold)) {
      await conn.execute(
        'INSERT IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
        [userId, ach.id],
      );

      const bonus = Number(ach.xp_bonus || 0);
      if (bonus > 0) {
        await awardXpInTransaction(conn, {
          userId,
          sourceType: 'achievement_bonus',
          sourceId: Number(ach.id),
          idempotencyKey: `achievement:${userId}:${ach.id}`,
          points: bonus,
          description: `Achievement unlocked: ${ach.title_en}`,
        });
      }

      await conn.execute(
        `INSERT INTO notifications (user_id, type, title_text, body_text, link_url)
         VALUES (?, 'achievement', ?, ?, '/profile')`,
        [
          userId,
          `Achievement unlocked: ${ach.title_en}`,
          `You earned the ${ach.title_en} badge (+${bonus} XP).`,
        ],
      );

      unlocked.push({
        slug: String(ach.slug),
        titleEn: String(ach.title_en),
        xpBonus: bonus,
      });
    }
  }

  return unlocked;
}
