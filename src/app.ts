import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import { env } from './config/env';
import { router } from './routes';
import { mountDocs } from './docs/openapi';
import { errorHandler } from './middleware/error';
import { httpLogger } from './middleware/httpLogger';
import { metricsAuth } from './middleware/metricsAuth';
import { httpMetricsMiddleware, renderPrometheusMetrics } from './infra/metrics';
import { readiness } from './infra/health';
import { asyncHandler } from './utils/asyncHandler';
import { Sentry } from './instrument';

export function createApp() {
  const app = express();
  app.set('trust proxy', true); // Render/Upstash sit behind a proxy — needed for correct req.ip
  app.use(helmet());
  app.use(compression()); // gzip — JSON payloads shrink ~5-10×, critical on slow mobile networks
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  app.use(httpLogger);
  app.use(httpMetricsMiddleware);
  app.get('/health', (_req, res) => res.json({ ok: true, uptimeSeconds: process.uptime() }));
  app.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const result = await readiness();
      res.status(result.ok ? 200 : 503).json(result);
    }),
  );
  app.get(
    '/metrics',
    metricsAuth,
    asyncHandler(async (_req, res) => {
      res.type('text/plain; version=0.0.4; charset=utf-8').send(await renderPrometheusMetrics());
    }),
  );
  mountDocs(app); // Swagger UI at /docs
  app.use('/api/v1', router);
  Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler); // must be last
  return app;
}
