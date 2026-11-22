import { RowDataPacket } from 'mysql2/promise';
import { localStore } from '../db/localStore.ts';
import { isDatabaseConfigured, queryRows, withTransaction } from '../db/pool.ts';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.ts';
import {
  awardXpInTransaction,
  evaluateAndUnlockAchievementsInTransaction,
} from './gamificationService.ts';

export async function listPosts(params: {
  postType?: 'create_showcase' | 'discussion';
  category?: string;
  groupId?: number;
  search?: string;
  viewerUserId?: number;
  limit?: number;
  offset?: number;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.listPosts(params);
  }
  const conditions: string[] = ["p.moderation_status = 'approved'"];
  const values: unknown[] = [];

  if (params.postType) {
    conditions.push('p.post_type = ?');
    values.push(params.postType);
  }
  if (params.category) {
    conditions.push('p.category = ?');
    values.push(params.category);
  }
  if (params.groupId) {
    conditions.push('p.group_id = ?');
    values.push(params.groupId);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push('(p.title LIKE ? OR p.body LIKE ?)');
    values.push(q, q);
  }
  if (params.viewerUserId) {
    conditions.push(
      'p.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)',
    );
    values.push(params.viewerUserId);
  }

  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const offset = Math.max(0, params.offset ?? 0);

  const viewerReactSelect = params.viewerUserId
    ? ', (SELECT reaction_type FROM post_reactions pr WHERE pr.post_id = p.id AND pr.user_id = ? LIMIT 1) AS user_reaction'
    : '';
  const queryParams = params.viewerUserId
    ? [params.viewerUserId, ...values, limit, offset]
    : [...values, limit, offset];

  return queryRows<RowDataPacket[]>(
    `SELECT
       p.id, p.user_id, p.group_id, p.post_type, p.category, p.title, p.body,
       p.media_url, p.likes_count, p.comments_count, p.is_sample, p.created_at,
       up.display_name AS author_name, up.username AS author_username, up.avatar_url AS author_avatar,
       g.name AS group_name
       ${viewerReactSelect}
     FROM creative_posts p
     INNER JOIN user_profiles up ON up.user_id = p.user_id
     INNER JOIN users u ON u.id = p.user_id
     LEFT JOIN community_groups g ON g.id = p.group_id
     WHERE u.status = 'active' AND ${conditions.join(' AND ')}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    queryParams,
  );
}

export async function createPost(params: {
  userId: number;
  postType: 'create_showcase' | 'discussion';
  category: string;
  title: string;
  body: string;
  groupId?: number | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.createPost(params);
  }
  return withTransaction(async (conn) => {
    if (params.groupId) {
      const [gRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM community_groups WHERE id = ? AND status = 'active' LIMIT 1",
        [params.groupId],
      );
      if (gRows.length === 0) {
        throw new NotFoundError('Group not found.');
      }
    }

    const [res] = await conn.execute<any>(
      `INSERT INTO creative_posts
        (user_id, group_id, post_type, category, title, body, media_url, media_mime, moderation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      [
        params.userId,
        params.groupId ?? null,
        params.postType,
        params.category,
        params.title,
        params.body,
        params.mediaUrl ?? null,
        params.mediaMime ?? null,
      ],
    );
    const postId = Number(res.insertId);

    // Award XP up to once per post (capped cleanly by idempotency and only for first 3 posts/day or modest 15 XP)
    const [[todayPosts]] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM xp_transactions WHERE user_id = ? AND source_type = ? AND created_at >= CURDATE()',
      [params.userId, 'community_post'],
    );
    if (Number(todayPosts?.cnt ?? 0) < 3) {
      await awardXpInTransaction(conn, {
        userId: params.userId,
        sourceType: 'community_post',
        sourceId: postId,
        idempotencyKey: `post:${params.userId}:${postId}`,
        points: 15,
        description: `Published community post: ${params.title}`,
      });
    }

    await evaluateAndUnlockAchievementsInTransaction(conn, params.userId);
    return { id: postId };
  });
}

export async function togglePostReaction(params: {
  postId: number;
  userId: number;
  reactionType: 'like' | 'celebrate' | 'helpful';
}) {
  if (!isDatabaseConfigured()) {
    return localStore.togglePostReaction(params);
  }
  return withTransaction(async (conn) => {
    const [posts] = await conn.execute<RowDataPacket[]>(
      "SELECT id FROM creative_posts WHERE id = ? AND moderation_status = 'approved' LIMIT 1",
      [params.postId],
    );
    if (posts.length === 0) {
      throw new NotFoundError('Post not found.');
    }

    const [existing] = await conn.execute<RowDataPacket[]>(
      'SELECT id, reaction_type FROM post_reactions WHERE post_id = ? AND user_id = ? LIMIT 1',
      [params.postId, params.userId],
    );

    let activeReaction: string | null = params.reactionType;

    if (existing.length > 0 && existing[0].reaction_type === params.reactionType) {
      await conn.execute('DELETE FROM post_reactions WHERE id = ?', [existing[0].id]);
      activeReaction = null;
    } else if (existing.length > 0) {
      await conn.execute('UPDATE post_reactions SET reaction_type = ? WHERE id = ?', [
        params.reactionType,
        existing[0].id,
      ]);
    } else {
      await conn.execute(
        'INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES (?, ?, ?)',
        [params.postId, params.userId, params.reactionType],
      );
    }

    const [[cntRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM post_reactions WHERE post_id = ?',
      [params.postId],
    );
    const likesCount = Number(cntRow?.cnt ?? 0);
    await conn.execute('UPDATE creative_posts SET likes_count = ? WHERE id = ?', [
      likesCount,
      params.postId,
    ]);

    return { likesCount, activeReaction };
  });
}

export async function listComments(postId: number, viewerUserId?: number) {
  if (!isDatabaseConfigured()) {
    return localStore.listComments(postId, viewerUserId);
  }
  const blockFilter = viewerUserId
    ? 'AND c.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)'
    : '';
  const params = viewerUserId ? [postId, viewerUserId] : [postId];

  return queryRows<RowDataPacket[]>(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at,
            up.display_name AS author_name, up.username AS author_username, up.avatar_url AS author_avatar
     FROM post_comments c
     INNER JOIN user_profiles up ON up.user_id = c.user_id
     WHERE c.post_id = ? AND c.moderation_status = 'visible' ${blockFilter}
     ORDER BY c.created_at ASC`,
    params,
  );
}

export async function addComment(params: { postId: number; userId: number; body: string }) {
  if (!isDatabaseConfigured()) {
    return localStore.addComment(params);
  }
  return withTransaction(async (conn) => {
    const [posts] = await conn.execute<RowDataPacket[]>(
      "SELECT id, user_id, title FROM creative_posts WHERE id = ? AND moderation_status = 'approved' LIMIT 1",
      [params.postId],
    );
    if (posts.length === 0) {
      throw new NotFoundError('Post not found.');
    }

    const [res] = await conn.execute<any>(
      "INSERT INTO post_comments (post_id, user_id, body, moderation_status) VALUES (?, ?, ?, 'visible')",
      [params.postId, params.userId, params.body],
    );
    const [[cntRow]] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM post_comments WHERE post_id = ? AND moderation_status = 'visible'",
      [params.postId],
    );
    await conn.execute('UPDATE creative_posts SET comments_count = ? WHERE id = ?', [
      Number(cntRow?.cnt ?? 0),
      params.postId,
    ]);

    const postOwnerId = Number(posts[0].user_id);
    if (postOwnerId !== params.userId) {
      await conn.execute(
        `INSERT INTO notifications (user_id, type, title_text, body_text, link_url)
         VALUES (?, 'comment', 'New comment on your post', ?, '/connect')`,
        [postOwnerId, `Someone commented on "${posts[0].title}".`],
      );
    }

    return { id: Number(res.insertId), commentsCount: Number(cntRow?.cnt ?? 0) };
  });
}

export async function listGroups(viewerUserId?: number) {
  if (!isDatabaseConfigured()) {
    return localStore.listGroups(viewerUserId);
  }
  const memberJoin = viewerUserId
    ? 'LEFT JOIN group_memberships gm ON gm.group_id = g.id AND gm.user_id = ?'
    : '';
  const params = viewerUserId ? [viewerUserId] : [];
  return queryRows<RowDataPacket[]>(
    `SELECT g.* ${viewerUserId ? ', (gm.id IS NOT NULL) AS is_member' : ''}
     FROM community_groups g
     ${memberJoin}
     WHERE g.status = 'active'
     ORDER BY g.member_count DESC, g.created_at DESC`,
    params,
  );
}

export async function createGroup(params: {
  userId: number;
  name: string;
  description: string;
  category: string;
  isPrivate: boolean;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.createGroup(params);
  }
  const baseSlug = params.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 70);
  const slug = `${baseSlug || 'group'}-${Date.now().toString(36)}`;

  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
      `INSERT INTO community_groups (slug, name, description, category, created_by, is_private, member_count, status)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'active')`,
      [slug, params.name, params.description, params.category, params.userId, params.isPrivate ? 1 : 0],
    );
    const groupId = Number(res.insertId);
    await conn.execute(
      "INSERT INTO group_memberships (group_id, user_id, role) VALUES (?, ?, 'moderator')",
      [groupId, params.userId],
    );
    return { id: groupId, slug };
  });
}

export async function toggleGroupMembership(groupId: number, userId: number) {
  if (!isDatabaseConfigured()) {
    return localStore.toggleGroupMembership(groupId, userId);
  }
  return withTransaction(async (conn) => {
    const [gRows] = await conn.execute<RowDataPacket[]>(
      "SELECT id FROM community_groups WHERE id = ? AND status = 'active' LIMIT 1",
      [groupId],
    );
    if (gRows.length === 0) {
      throw new NotFoundError('Group not found.');
    }

    const [existing] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1',
      [groupId, userId],
    );

    let joined = false;
    if (existing.length > 0) {
      await conn.execute('DELETE FROM group_memberships WHERE id = ?', [existing[0].id]);
      joined = false;
    } else {
      await conn.execute(
        "INSERT INTO group_memberships (group_id, user_id, role) VALUES (?, ?, 'member')",
        [groupId, userId],
      );
      joined = true;
    }

    const [[cntRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM group_memberships WHERE group_id = ?',
      [groupId],
    );
    const memberCount = Number(cntRow?.cnt ?? 0);
    await conn.execute('UPDATE community_groups SET member_count = ? WHERE id = ?', [
      memberCount,
      groupId,
    ]);
    return { joined, memberCount };
  });
}

export async function toggleFollowUser(followerId: number, targetUserId: number) {
  if (!isDatabaseConfigured()) {
    return localStore.toggleFollowUser(followerId, targetUserId);
  }
  if (followerId === targetUserId) {
    throw new ForbiddenError('You cannot follow yourself.');
  }
  return withTransaction(async (conn) => {
    const [existing] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
      [followerId, targetUserId],
    );
    if (existing.length > 0) {
      await conn.execute('DELETE FROM user_follows WHERE id = ?', [existing[0].id]);
      return { following: false };
    }
    await conn.execute('INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)', [
      followerId,
      targetUserId,
    ]);
    return { following: true };
  });
}

export async function blockUser(blockerId: number, blockedId: number, reason?: string) {
  if (!isDatabaseConfigured()) {
    return localStore.blockUser(blockerId, blockedId, reason);
  }
  if (blockerId === blockedId) {
    throw new ForbiddenError('You cannot block yourself.');
  }
  await withTransaction(async (conn) => {
    await conn.execute(
      'INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, reason) VALUES (?, ?, ?)',
      [blockerId, blockedId, reason ?? null],
    );
    await conn.execute(
      'DELETE FROM user_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)',
      [blockerId, blockedId, blockedId, blockerId],
    );
  });
}

export async function unblockUser(blockerId: number, blockedId: number) {
  if (!isDatabaseConfigured()) {
    return localStore.unblockUser(blockerId, blockedId);
  }
  await queryRows('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [
    blockerId,
    blockedId,
  ]);
}

export async function createContentReport(params: {
  reporterId: number;
  targetType: 'post' | 'comment' | 'user' | 'opportunity';
  targetId: number;
  reason: string;
  details?: string;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.createContentReport(params);
  }
  return withTransaction(async (conn) => {
    const [dup] = await conn.execute<RowDataPacket[]>(
      "SELECT id FROM content_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status IN ('open', 'reviewing') LIMIT 1",
      [params.reporterId, params.targetType, params.targetId],
    );
    if (dup.length > 0) {
      throw new ConflictError('You have already submitted an active report for this item.');
    }

    const [res] = await conn.execute<any>(
      `INSERT INTO content_reports (reporter_id, target_type, target_id, reason, details, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [params.reporterId, params.targetType, params.targetId, params.reason, params.details ?? null],
    );
    return { id: Number(res.insertId) };
  });
}
