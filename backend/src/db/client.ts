import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const isLocal = (process.env.DATABASE_URL || '').includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10_000,   // close idle connections after 10s
  connectionTimeoutMillis: 8_000,
  allowExitOnIdle: false,
});

// Reconnect on unexpected termination
pool.on('error', (err) => {
  console.error('Postgres pool error — pool will reconnect on next query:', err.message);
});

export { pool };
export const db = drizzle(pool, { schema });

// Retry a DB operation on "Connection terminated" errors
export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isConnErr = err.message?.includes('terminated') || err.message?.includes('ECONNRESET') || err.code === '57P01';
      if (isConnErr && i < retries) {
        console.warn(`DB connection error, retrying (${i + 1}/${retries})…`);
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max DB retries exceeded');
}

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      okta_agent_id TEXT UNIQUE,
      owner_id TEXT,
      owner_name TEXT,
      owner_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      config JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_resources (
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, resource_id)
    );
  `);
}

const DEFAULT_RESOURCES = [
  { name: 'AWS Bedrock', type: 'cloud_ai', description: 'Amazon Bedrock foundation models and agent runtime' },
  { name: 'Slack MCP Server', type: 'mcp_server', description: 'Slack MCP connector for agent messaging and notifications' },
  { name: 'GitHub MCP Server', type: 'mcp_server', description: 'GitHub MCP connector for code operations and repository access' },
  { name: 'Salesforce', type: 'saas_app', description: 'Salesforce CRM — contacts, accounts, opportunities' },
  { name: 'Jira', type: 'saas_app', description: 'Atlassian Jira project management and issue tracking' },
  { name: 'Google Workspace', type: 'saas_app', description: 'Google Workspace — Gmail, Drive, Calendar, Docs' },
  { name: 'OpenAI API', type: 'api', description: 'OpenAI GPT-4 and other model APIs' },
  { name: 'Confluence', type: 'saas_app', description: 'Atlassian Confluence knowledge base and documentation' },
];

export async function seedResources() {
  const existing = await pool.query('SELECT COUNT(*) FROM resources');
  if (parseInt(existing.rows[0].count) > 0) return;
  for (const r of DEFAULT_RESOURCES) {
    await pool.query(
      'INSERT INTO resources (name, type, description) VALUES ($1, $2, $3)',
      [r.name, r.type, r.description]
    );
  }
  console.log(`✅ Seeded ${DEFAULT_RESOURCES.length} default resources`);
}
