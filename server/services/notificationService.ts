import { RowDataPacket } from 'mysql2/promise';
import { executeSql, queryRows } from '../db/pool.ts';

export async function listNotifications(userId: number, limit = 30) {
  const rows = await queryRows<RowDataPacket[]>(
    `SELECT id, type, title_text, body_text, link_url, is_read, read_at, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, Math.min(100, limit)],
  );

  const [unreadRow] = await queryRows<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId],
  );

  return {
    notifications: rows,
    unreadCount: Number(unreadRow?.cnt ?? 0),
  };
}

export async function markNotificationRead(userId: number, notificationId: number) {
  await executeSql(
    'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
    [notificationId, userId],
  );
}

export async function markAllNotificationsRead(userId: number) {
  await executeSql(
    'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
    [userId],
  );
}

export async function getNotificationPreferences(userId: number) {
  const rows = await queryRows<RowDataPacket[]>(
    'SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1',
    [userId],
  );
  if (rows.length === 0) {
    return {
      challengeReminders: true,
      learningUpdates: true,
      communityActivity: true,
      opportunityAlerts: true,
      announcements: true,
    };
  }
  const r = rows[0];
  return {
    challengeReminders: Boolean(r.challenge_reminders),
    learningUpdates: Boolean(r.learning_updates),
    communityActivity: Boolean(r.community_activity),
    opportunityAlerts: Boolean(r.opportunity_alerts),
    announcements: Boolean(r.announcements),
  };
}

export async function updateNotificationPreferences(
  userId: number,
  prefs: {
    challengeReminders: boolean;
    learningUpdates: boolean;
    communityActivity: boolean;
    opportunityAlerts: boolean;
    announcements: boolean;
  },
) {
  await executeSql(
    `INSERT INTO notification_preferences
      (user_id, challenge_reminders, learning_updates, community_activity, opportunity_alerts, announcements)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      challenge_reminders = VALUES(challenge_reminders),
      learning_updates = VALUES(learning_updates),
      community_activity = VALUES(community_activity),
      opportunity_alerts = VALUES(opportunity_alerts),
      announcements = VALUES(announcements)`,
    [
      userId,
      prefs.challengeReminders ? 1 : 0,
      prefs.learningUpdates ? 1 : 0,
      prefs.communityActivity ? 1 : 0,
      prefs.opportunityAlerts ? 1 : 0,
      prefs.announcements ? 1 : 0,
    ],
  );
}
