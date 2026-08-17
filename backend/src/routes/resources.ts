import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { resources, agentResources } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router();

// GET /api/resources — all stored resources PLUS live Okta auth servers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stored = await db.select().from(resources).orderBy(resources.type, resources.name);

    // Fetch live Okta authorization servers and merge (don't duplicate)
    let authServers: { id: string; name: string; type: string; description: string; config: any }[] = [];
    try {
      const oktaServers = await okta.listAuthorizationServers();
      const storedOktaIds = new Set(stored.filter(r => r.type === 'auth_server').map(r => (r.config as any)?.oktaId));
      authServers = oktaServers
        .filter(s => !storedOktaIds.has(s.id))
        .map(s => ({
          id: `okta-as-${s.id}`,
          name: s.name,
          type: 'auth_server',
          description: s.description || `Okta Authorization Server · ${s.issuer || s.id}`,
          config: { oktaId: s.id, issuer: s.issuer, status: s.status, liveFromOkta: true },
        }));
    } catch {}

    res.json([...stored, ...authServers]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/resources
router.post('/', async (req: Request, res: Response) => {
  const { name, type, description, config } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  try {
    const [resource] = await db
      .insert(resources)
      .values({ name, type, description: description || null, config: config || null })
      .returning();
    res.status(201).json(resource);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/resources/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(agentResources).where(eq(agentResources.resourceId, req.params.id));
    await db.delete(resources).where(eq(resources.id, req.params.id));
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
