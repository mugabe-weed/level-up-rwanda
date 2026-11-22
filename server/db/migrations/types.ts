import { PoolConnection } from 'mysql2/promise';

export interface Migration {
  id: string;
  name: string;
  upStatements: string[];
  downStatements: string[];
  verify?: (conn: PoolConnection) => Promise<void>;
}
