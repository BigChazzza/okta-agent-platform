import { pgTable, text, timestamp, uuid, jsonb, primaryKey, numeric } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  oktaAgentId: text('okta_agent_id').unique(),
  ownerId: text('owner_id'),
  ownerName: text('owner_name'),
  ownerEmail: text('owner_email'),
  status: text('status').default('pending').notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  testClientSecret: text('test_client_secret'),
  testPrivateKeyPem: text('test_private_key_pem'),
  testPrivateKeyKid: text('test_private_key_kid'),
});

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  config: jsonb('config'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agentResources = pgTable(
  'agent_resources',
  {
    agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.resourceId] }) })
);

// Toy MCP server data for the Chat feature — campaigns managed via create_campaign/get_campaign/
// search_campaigns/update_campaign/delete_campaign tools, called over a real XAA-delegated token.
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('draft').notNull(),
  budget: numeric('budget'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
