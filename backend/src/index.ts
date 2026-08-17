import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import agentsRouter from './routes/agents';
import usersRouter from './routes/users';
import resourcesRouter from './routes/resources';
import { migrate, seedResources } from './db/client';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:3000', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/agents', agentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/resources', resourcesRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await migrate();
    console.log('✅ Database migrated');
    await seedResources();
    app.listen(PORT, () => {
      console.log(`🚀 Backend running on port ${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start:', e);
    process.exit(1);
  }
}

start();
