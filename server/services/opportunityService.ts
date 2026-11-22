import { RowDataPacket } from 'mysql2/promise';
import { queryRows, withTransaction } from '../db/pool.ts';
import { NotFoundError } from '../utils/errors.ts';

export async function listOpportunityCategories() {
  return queryRows<RowDataPacket[]>(
    'SELECT id, slug, name_en, name_rw, name_fr FROM opportunity_categories ORDER BY sort_order ASC',
  );
}

export async function listOpportunities(params: {
  type?: string;
  categorySlug?: string;
  remoteOnly?: boolean;
  verifiedOnly?: boolean;
  includeExpired?: boolean;
  search?: string;
  userId?: number;
}) {
  const conditions: string[] = ["o.approval_status = 'approved'"];
  const values: unknown[] = [];

  if (params.type) {
    conditions.push('o.opportunity_type = ?');
    values.push(params.type);
  }
  if (params.categorySlug) {
    conditions.push('cat.slug = ?');
    values.push(params.categorySlug);
  }
  if (params.remoteOnly) {
    conditions.push('o.is_remote = 1');
  }
  if (params.verifiedOnly) {
    conditions.push("o.verified_status = 'verified'");
  }
  if (!params.includeExpired) {
    conditions.push('(o.deadline_at IS NULL OR o.deadline_at >= NOW())');
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push('(o.title LIKE ? OR o.organization_name LIKE ? OR o.summary LIKE ? OR o.location LIKE ?)');
    values.push(q, q, q, q);
  }

  const savedJoin = params.userId
    ? 'LEFT JOIN saved_opportunities so ON so.opportunity_id = o.id AND so.user_id = ?'
    : '';
  const queryParams = params.userId ? [params.userId, ...values] : values;

  const rows = await queryRows<RowDataPacket[]>(
    `SELECT
       o.*,
       (o.deadline_at IS NOT NULL AND o.deadline_at < NOW()) AS is_expired,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr
       ${params.userId ? ', (so.id IS NOT NULL) AS is_saved' : ''}
     FROM opportunities o
     INNER JOIN opportunity_categories cat ON cat.id = o.category_id
     ${savedJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.is_featured DESC, o.deadline_at IS NULL ASC, o.deadline_at ASC, o.created_at DESC`,
    queryParams,
  );

  return rows;
}

export async function submitOpportunity(params: {
  userId: number;
  categoryId: number;
  opportunityType: string;
  title: string;
  organizationName: string;
  location: string;
  isRemote: boolean;
  summary: string;
  eligibility: string;
  applicationUrl: string;
  deadlineAt?: string | null;
  autoApprove?: boolean;
}) {
  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
      `INSERT INTO opportunities
        (category_id, opportunity_type, title, organization_name, location, is_remote, summary, eligibility, application_url, deadline_at, approval_status, verified_status, submitted_by, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.categoryId,
        params.opportunityType,
        params.title,
        params.organizationName,
        params.location,
        params.isRemote ? 1 : 0,
        params.summary,
        params.eligibility,
        params.applicationUrl,
        params.deadlineAt || null,
        params.autoApprove ? 'approved' : 'pending',
        params.autoApprove ? 'verified' : 'unverified',
        params.userId,
        params.autoApprove ? params.userId : null,
      ],
    );
    return { id: Number(res.insertId), status: params.autoApprove ? 'approved' : 'pending' };
  });
}

export async function toggleSavedOpportunity(opportunityId: number, userId: number) {
  return withTransaction(async (conn) => {
    const [opps] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM opportunities WHERE id = ? LIMIT 1',
      [opportunityId],
    );
    if (opps.length === 0) {
      throw new NotFoundError('Opportunity not found.');
    }

    const [existing] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM saved_opportunities WHERE opportunity_id = ? AND user_id = ? LIMIT 1',
      [opportunityId, userId],
    );
    if (existing.length > 0) {
      await conn.execute('DELETE FROM saved_opportunities WHERE id = ?', [existing[0].id]);
      return { saved: false };
    }
    await conn.execute('INSERT INTO saved_opportunities (opportunity_id, user_id) VALUES (?, ?)', [
      opportunityId,
      userId,
    ]);
    return { saved: true };
  });
}
