import { Router, Request, Response } from 'express';
import * as okta from '../services/okta';

const router = Router();

// GET /api/apps — search Okta OAuth service apps, backs Machine Access's app-caller picker
router.get('/', async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const apps = await okta.searchApps(q, limit);
    res.json(apps);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
