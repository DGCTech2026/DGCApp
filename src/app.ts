import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { router } from './routes';
import { mountDocs } from './docs/openapi';
import { errorHandler } from './middleware/error';

export function createApp() {
  const app = express();
  app.set('trust proxy', true); // Render/Upstash sit behind a proxy — needed for correct req.ip
  app.use(helmet());
  app.use(compression()); // gzip — JSON payloads shrink ~5-10×, critical on slow mobile networks
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  mountDocs(app); // Swagger UI at /docs
  app.use('/api/v1', router);
  app.use(errorHandler); // must be last
  return app;
}
