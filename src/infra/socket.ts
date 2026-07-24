import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import { makeRedis } from './redis';
import { env } from '../config/env';
import { recordSocketConnected, recordSocketDisconnected } from './metrics';

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, { cors: { origin: env.CORS_ORIGIN } });
  // pub/sub pair lets multiple app instances broadcast to each other.
  const pub = makeRedis();
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));
  io.on('connection', (socket) => {
    recordSocketConnected();
    socket.on('disconnect', recordSocketDisconnected);
  });
  return io;
}
