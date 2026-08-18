import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import agentsRouter from './routes/agents';
import usersRouter from './routes/users';
import resourcesRouter from './routes/resources';
import connectionsRouter from './routes/connections';
import { migrate, seedResources } from './db/client';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:3000', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Keep-alive: ping DB every 8 minutes to prevent idle connection drop
import { pool as pgPool } from './db/client';
setInterval(async () => {
  try { await pgPool.query('SELECT 1'); } catch (e: any) {
    console.warn('Keep-alive ping failed (will retry on next request):', e.message);
  }
}, 8 * 60 * 1000);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/agents', agentsRouter);
app.use('/api/agents', connectionsRouter);
app.use('/api/users', usersRouter);
app.use('/api/resources', resourcesRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  // Start HTTP server immediately so Render health check passes
  app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
  });

  // DB setup runs after server is up — retries on failure
  const setupDb = async (retries = 5): Promise<void> => {
    try {
      await migrate();
      console.log('✅ Database migrated');
      await seedResources();
      console.log('✅ Ready');
    } catch (e: any) {
      if (retries > 0) {
        console.warn(`⚠️  DB not ready, retrying in 5s (${retries} left):`, e.message);
        await new Promise(r => setTimeout(r, 5000));
        return setupDb(retries - 1);
      }
      console.error('❌ DB setup failed:', e.message);
    }
  };
  setupDb();
}

start();
