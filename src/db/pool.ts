import pg from 'pg';
import { config } from '../config.ts';

// One connection pool for the whole process. The LangGraph checkpointer (step 6)
// will share it instead of opening its own connections.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
