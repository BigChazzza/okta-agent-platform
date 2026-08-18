import { Router, Request, Response } from 'express';
import * as okta from '../services/okta';

const router = Router();

// GET /api/resources — all available resources from Okta's potential connections API
router.get('/', async (_req: Request, res: Response) => {
  try {
    const connections = await okta.listPotentialConnections();
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
