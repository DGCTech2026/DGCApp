import type { RequestHandler } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Worker } from 'bullmq';
import { emailQueue, growthQueue, notificationQueue, smsQueue } from './queue';

type LabelValue = string | number;
type Labels = Record<string, LabelValue>;
type MetricEntry = { labels: Labels; value: number };
type HistogramEntry = {
  labels: Labels;
  buckets: number[];
  count: number;
  sum: number;
};

const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const JOB_DURATION_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
const QUEUE_STATES = ['waiting', 'delayed', 'active', 'completed', 'failed', 'paused'] as const;
const QUEUE_METRICS_TIMEOUT_MS = 750;

const startedAt = Date.now();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const httpRequestsTotal = new Map<string, MetricEntry>();
const httpRequestsInFlight = new Map<string, MetricEntry>();
const httpRequestDurationSeconds = new Map<string, HistogramEntry>();
const queueJobsTotal = new Map<string, MetricEntry>();
const queueJobDurationSeconds = new Map<string, HistogramEntry>();

let socketConnections = 0;
let socketConnectionsTotal = 0;

export const httpMetricsMiddleware: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  const method = req.method;

  increment(httpRequestsInFlight, { method }, 1);

  res.once('finish', () => {
    increment(httpRequestsInFlight, { method }, -1);

    const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
    const labels = {
      method,
      route: normalizeRoute(req.originalUrl || req.path || '/'),
      status_code: res.statusCode,
      status_class: `${Math.floor(res.statusCode / 100)}xx`,
    };

    increment(httpRequestsTotal, labels, 1);
    observeHistogram(httpRequestDurationSeconds, HTTP_DURATION_BUCKETS, labels, durationSeconds);
  });

  next();
};

export function recordSocketConnected() {
  socketConnections += 1;
  socketConnectionsTotal += 1;
}

export function recordSocketDisconnected() {
  socketConnections = Math.max(0, socketConnections - 1);
}

export function instrumentWorker(worker: Worker, queueName: string) {
  worker.on('completed', (job) => {
    const duration = jobDurationSeconds(job);
    const labels = { queue: queueName, job: job.name, status: 'completed' };

    increment(queueJobsTotal, labels, 1);
    if (duration !== undefined) observeHistogram(queueJobDurationSeconds, JOB_DURATION_BUCKETS, labels, duration);
  });

  worker.on('failed', (job) => {
    const duration = jobDurationSeconds(job);
    const labels = {
      queue: queueName,
      job: job?.name ?? 'unknown',
      status: 'failed',
    };

    increment(queueJobsTotal, labels, 1);
    if (duration !== undefined) observeHistogram(queueJobDurationSeconds, JOB_DURATION_BUCKETS, labels, duration);
  });
}

export async function renderPrometheusMetrics() {
  const lines = [
    '# HELP process_uptime_seconds Process uptime in seconds.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${formatNumber(process.uptime())}`,
    '# HELP process_start_time_seconds Unix timestamp for when this process started.',
    '# TYPE process_start_time_seconds gauge',
    `process_start_time_seconds ${formatNumber(startedAt / 1000)}`,
    ...memoryMetrics(),
    ...eventLoopMetrics(),
    ...counterLines('http_requests_total', 'Total HTTP requests.', httpRequestsTotal),
    ...gaugeLines('http_requests_in_flight', 'HTTP requests currently in flight.', httpRequestsInFlight),
    ...histogramLines(
      'http_request_duration_seconds',
      'HTTP request duration in seconds.',
      httpRequestDurationSeconds,
      HTTP_DURATION_BUCKETS,
    ),
    '# HELP socket_connections Active Socket.io connections on this process.',
    '# TYPE socket_connections gauge',
    `socket_connections ${socketConnections}`,
    '# HELP socket_connections_total Total Socket.io connections accepted by this process.',
    '# TYPE socket_connections_total counter',
    `socket_connections_total ${socketConnectionsTotal}`,
    ...counterLines('bullmq_jobs_total', 'BullMQ jobs processed by this process.', queueJobsTotal),
    ...histogramLines(
      'bullmq_job_duration_seconds',
      'BullMQ job duration in seconds.',
      queueJobDurationSeconds,
      JOB_DURATION_BUCKETS,
    ),
    ...(await queueDepthMetrics()),
  ];

  return `${lines.join('\n')}\n`;
}

function increment(store: Map<string, MetricEntry>, labels: Labels, amount: number) {
  const key = labelsKey(labels);
  const current = store.get(key);

  if (current) {
    current.value += amount;
    return;
  }

  store.set(key, { labels, value: amount });
}

function observeHistogram(store: Map<string, HistogramEntry>, buckets: number[], labels: Labels, value: number) {
  const key = labelsKey(labels);
  let current = store.get(key);

  if (!current) {
    current = { labels, buckets: buckets.map(() => 0), count: 0, sum: 0 };
    store.set(key, current);
  }

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    if (bucket !== undefined && value <= bucket) current.buckets[i] = (current.buckets[i] ?? 0) + 1;
  }

  current.count += 1;
  current.sum += value;
}

function counterLines(name: string, help: string, store: Map<string, MetricEntry>) {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    ...[...store.values()].map((entry) => `${name}${formatLabels(entry.labels)} ${formatNumber(entry.value)}`),
  ];
}

function gaugeLines(name: string, help: string, store: Map<string, MetricEntry>) {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    ...[...store.values()].map((entry) => `${name}${formatLabels(entry.labels)} ${formatNumber(entry.value)}`),
  ];
}

function histogramLines(name: string, help: string, store: Map<string, HistogramEntry>, buckets: number[]) {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];

  for (const entry of store.values()) {
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i];
      if (bucket === undefined) continue;
      lines.push(`${name}_bucket${formatLabels({ ...entry.labels, le: bucket })} ${entry.buckets[i] ?? 0}`);
    }

    lines.push(`${name}_bucket${formatLabels({ ...entry.labels, le: '+Inf' })} ${entry.count}`);
    lines.push(`${name}_count${formatLabels(entry.labels)} ${entry.count}`);
    lines.push(`${name}_sum${formatLabels(entry.labels)} ${formatNumber(entry.sum)}`);
  }

  return lines;
}

function memoryMetrics() {
  const usage = process.memoryUsage();
  return [
    '# HELP process_memory_bytes Process memory usage in bytes.',
    '# TYPE process_memory_bytes gauge',
    `process_memory_bytes${formatLabels({ type: 'rss' })} ${usage.rss}`,
    `process_memory_bytes${formatLabels({ type: 'heap_total' })} ${usage.heapTotal}`,
    `process_memory_bytes${formatLabels({ type: 'heap_used' })} ${usage.heapUsed}`,
    `process_memory_bytes${formatLabels({ type: 'external' })} ${usage.external}`,
    `process_memory_bytes${formatLabels({ type: 'array_buffers' })} ${usage.arrayBuffers}`,
  ];
}

function eventLoopMetrics() {
  return [
    '# HELP nodejs_event_loop_delay_seconds Event loop delay in seconds.',
    '# TYPE nodejs_event_loop_delay_seconds gauge',
    `nodejs_event_loop_delay_seconds${formatLabels({ quantile: 'mean' })} ${formatNumber(nanosToSeconds(eventLoopDelay.mean))}`,
    `nodejs_event_loop_delay_seconds${formatLabels({ quantile: 'p95' })} ${formatNumber(
      nanosToSeconds(eventLoopDelay.percentile(95)),
    )}`,
    `nodejs_event_loop_delay_seconds${formatLabels({ quantile: 'max' })} ${formatNumber(nanosToSeconds(eventLoopDelay.max))}`,
  ];
}

async function queueDepthMetrics() {
  const queues = [
    { name: 'email', queue: emailQueue },
    { name: 'sms', queue: smsQueue },
    { name: 'notification', queue: notificationQueue },
    { name: 'growth', queue: growthQueue },
  ];
  const lines = [
    '# HELP bullmq_queue_depth BullMQ queue depth by state.',
    '# TYPE bullmq_queue_depth gauge',
    '# HELP bullmq_queue_metrics_up Whether queue depth metrics were collected successfully.',
    '# TYPE bullmq_queue_metrics_up gauge',
  ];

  const results = await Promise.all(
    queues.map(async ({ name, queue }) => {
      try {
        const counts = await withTimeout(queue.getJobCounts(...QUEUE_STATES), QUEUE_METRICS_TIMEOUT_MS, undefined);
        return { name, counts };
      } catch {
        return { name, counts: undefined };
      }
    }),
  );

  for (const result of results) {
    lines.push(`bullmq_queue_metrics_up${formatLabels({ queue: result.name })} ${result.counts ? 1 : 0}`);

    for (const state of QUEUE_STATES) {
      lines.push(
        `bullmq_queue_depth${formatLabels({ queue: result.name, state })} ${result.counts ? (result.counts[state] ?? 0) : 0}`,
      );
    }
  }

  return lines;
}

function normalizeRoute(url: string) {
  const path = url.split('?')[0] || '/';
  const normalized = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{24}$/i.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return ':id';
      if (/^c[a-z0-9]{20,}$/i.test(segment)) return ':id';
      if (/^[A-Za-z0-9_-]{20,}$/.test(segment) && /\d/.test(segment)) return ':id';
      return segment;
    })
    .join('/');

  return normalized ? `/${normalized}` : '/';
}

function jobDurationSeconds(job: { processedOn?: number; finishedOn?: number; timestamp?: number } | undefined) {
  const started = job?.processedOn ?? job?.timestamp;
  if (!started) return undefined;

  const duration = ((job?.finishedOn ?? Date.now()) - started) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function labelsKey(labels: Labels) {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}:${String(labels[key])}`)
    .join('|');
}

function formatLabels(labels: Labels) {
  const entries = Object.entries(labels);
  if (!entries.length) return '';

  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(String(value))}"`).join(',')}}`;
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toString() : '0';
}

function nanosToSeconds(value: number) {
  return Number.isFinite(value) ? value / 1_000_000_000 : 0;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
