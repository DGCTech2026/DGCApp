import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';
import { env } from './config/env';

const release =
  env.SENTRY_RELEASE ??
  (process.env['RENDER_GIT_COMMIT'] ? `${env.SERVICE_NAME}@${process.env['RENDER_GIT_COMMIT']}` : undefined);

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    integrations: [Sentry.expressIntegration()],
    beforeSend(event) {
      redactRequest(event);
      return event;
    },
  });
}

export { Sentry };

export function captureJobException(queueName: string, job: Job | undefined, err: unknown) {
  if (!Sentry.getClient()) return;

  Sentry.withScope((scope) => {
    scope.setTag('queue', queueName);
    if (job?.name) scope.setTag('job', job.name);
    scope.setContext('job', {
      id: job?.id,
      name: job?.name,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts.attempts,
      timestamp: job?.timestamp,
      processedOn: job?.processedOn,
    });
    Sentry.captureException(err);
  });
}

export function flushSentry(timeoutMs = 2000) {
  return Sentry.getClient() ? Sentry.flush(timeoutMs) : Promise.resolve(true);
}

function redactRequest(event: Sentry.Event) {
  if (!event.request) return;

  if (event.request.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (['authorization', 'cookie', 'set-cookie'].includes(key.toLowerCase())) {
        delete event.request.headers[key];
      }
    }
  }

  delete event.request.cookies;

  if (event.request.data && typeof event.request.data === 'object' && !Array.isArray(event.request.data)) {
    const data = event.request.data as Record<string, unknown>;
    for (const key of ['password', 'code', 'token', 'accessToken', 'refreshToken']) {
      if (key in data) data[key] = '[redacted]';
    }
  }
}
