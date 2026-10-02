// @ts-nocheck — McpServer.registerTool() with Zod raw-shape schemas triggers TS2589 (excessively
// deep type instantiation) at this SDK/Zod version pairing.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { eq, or, ilike } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns } from '../db/schema';

// One JWKS per issuer, cached — createRemoteJWKSet keeps its own internal cache/refresh, so this
// just avoids constructing a new one (and losing that cache) on every tool call.
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(issuer: string) {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/v1/keys`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

async function verifyAndGetScopes(token: string, issuer: string): Promise<{ scopes: string[] }> {
  const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer, clockTolerance: 30 });
  const scopeClaim = payload.scp ?? payload.scope;
  const scopes = Array.isArray(scopeClaim) ? scopeClaim as string[] : typeof scopeClaim === 'string' ? scopeClaim.split(' ') : [];
  return { scopes };
}

function requireScope(scopes: string[], required: string) {
  if (!scopes.includes(required)) {
    throw new Error(`Insufficient scope — this tool requires '${required}'`);
  }
}

function errorResult(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// Builds a fresh McpServer bound to one session's bearer token + the issuer that token must be
// verified against (the Campaigns Custom AS, EXERCISE_SHARED_AUTH_SERVER_ID-style env var) — a
// new instance per MCP session.
export function createCampaignsMcpServer(bearerToken: string, issuer: string): McpServer {
  const server = new McpServer({ name: 'campaigns-mcp', version: '1.0.0' });

  async function scopesOrThrow(required: string): Promise<void> {
    const { scopes } = await verifyAndGetScopes(bearerToken, issuer);
    requireScope(scopes, required);
  }

  server.registerTool(
    'create_campaign',
    {
      description: 'Create a new marketing campaign',
      inputSchema: {
        name: z.string().describe('Campaign name'),
        description: z.string().optional().describe('Campaign description'),
        budget: z.number().optional().describe('Campaign budget in USD'),
        startDate: z.string().optional().describe('ISO 8601 start date'),
        endDate: z.string().optional().describe('ISO 8601 end date'),
      },
    },
    async (args) => {
      try {
        await scopesOrThrow('api.create');
        const [campaign] = await db.insert(campaigns).values({
          name: args.name,
          description: args.description,
          budget: args.budget != null ? String(args.budget) : undefined,
          startDate: args.startDate ? new Date(args.startDate) : undefined,
          endDate: args.endDate ? new Date(args.endDate) : undefined,
        }).returning();
        return jsonResult(campaign);
      } catch (e: any) {
        return errorResult(e.message);
      }
    }
  );

  server.registerTool(
    'get_campaign',
    {
      description: 'Get a marketing campaign by id',
      inputSchema: { id: z.string().describe('Campaign id') },
    },
    async (args) => {
      try {
        await scopesOrThrow('api.read');
        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, args.id));
        if (!campaign) return errorResult(`No campaign found with id ${args.id}`);
        return jsonResult(campaign);
      } catch (e: any) {
        return errorResult(e.message);
      }
    }
  );

  server.registerTool(
    'search_campaigns',
    {
      description: 'Search marketing campaigns by name or description, or list all if no query given',
      inputSchema: { query: z.string().optional().describe('Search text; omit to list all campaigns') },
    },
    async (args) => {
      try {
        await scopesOrThrow('api.search');
        const found = args.query
          ? await db.select().from(campaigns).where(or(ilike(campaigns.name, `%${args.query}%`), ilike(campaigns.description, `%${args.query}%`)))
          : await db.select().from(campaigns);
        return jsonResult(found);
      } catch (e: any) {
        return errorResult(e.message);
      }
    }
  );

  server.registerTool(
    'update_campaign',
    {
      description: 'Update fields on an existing marketing campaign',
      inputSchema: {
        id: z.string().describe('Campaign id'),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional().describe('e.g. draft, active, paused, completed'),
        budget: z.number().optional(),
        startDate: z.string().optional().describe('ISO 8601 start date'),
        endDate: z.string().optional().describe('ISO 8601 end date'),
      },
    },
    async (args) => {
      try {
        await scopesOrThrow('api.update');
        const { id, ...rest } = args;
        const patch: Record<string, any> = { ...rest, updatedAt: new Date() };
        if (rest.budget != null) patch.budget = String(rest.budget);
        if (rest.startDate) patch.startDate = new Date(rest.startDate);
        if (rest.endDate) patch.endDate = new Date(rest.endDate);
        const [campaign] = await db.update(campaigns).set(patch).where(eq(campaigns.id, id)).returning();
        if (!campaign) return errorResult(`No campaign found with id ${id}`);
        return jsonResult(campaign);
      } catch (e: any) {
        return errorResult(e.message);
      }
    }
  );

  server.registerTool(
    'delete_campaign',
    {
      description: 'Delete a marketing campaign by id',
      inputSchema: { id: z.string().describe('Campaign id') },
    },
    async (args) => {
      try {
        await scopesOrThrow('api.delete');
        await db.delete(campaigns).where(eq(campaigns.id, args.id));
        return jsonResult({ deleted: args.id });
      } catch (e: any) {
        return errorResult(e.message);
      }
    }
  );

  return server;
}
