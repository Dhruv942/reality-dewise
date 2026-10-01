import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  connectionTimeoutMillis: 10_000, // fail a request instead of waiting forever for a connection
});

// A dropped idle connection (DB restart, failover, idle reaping) emits 'error' on the pool.
// Without a listener Node treats it as fatal and kills the process. The pool discards the dead
// client and opens a new one on demand, so logging is all that is needed.
pool.on('error', (err) => {
  console.error('Idle database client error (connection will be replaced):', err.message);
});
