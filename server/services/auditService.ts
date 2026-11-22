import { PoolConnection } from 'mysql2/promise';
import { executeSql } from '../db/pool.ts';

export async function recordAuditLog(params: {
  actorUserId?: number | null;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  conn?: PoolConnection;
}): Promise<void> {
  await executeSql(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata_json, ip_address)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [
      params.actorUserId ?? null,
      params.action,
      params.targetType,
      params.targetId !== undefined && params.targetId !== null ? String(params.targetId) : null,
      JSON.stringify(params.metadata ?? {}),
      params.ipAddress ?? null,
    ],
    params.conn,
  );
}
