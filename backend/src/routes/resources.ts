import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { resources, agentResources } from '../db/schema';
import { eq } from 'drizzle-orm';
const router = Router();

// GET /api/resources — all stored resources PLUS live Okta auth servers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stored = await db.select().from(resources).orderBy(resources.type, resources.name);

    res.json(stored);
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
