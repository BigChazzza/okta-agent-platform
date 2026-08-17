import { Router, Request, Response } from 'express';
import * as okta from '../services/okta';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  const limit = parseInt(req.query.limit as string) || 25;
  try {
    const users = await okta.listUsers(q, limit);
    res.json(users);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
