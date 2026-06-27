import http from 'http';
import { createApp } from './app';
import { createSocketServer } from './infra/socket';
import { startWorkers } from './jobs';
import { env } from './config/env';
import { logger } from './infra/logger';

const app = createApp();
const server = http.createServer(app);

// Socket.io shares the SAME http server as Express.
const _io = createSocketServer(server);
// registerSocketHandlers(_io);  // wired in the chat module later

startWorkers(); // in-process now; can move to its own Render service later

server.listen(env.PORT, () => logger.info(`API + sockets on :${env.PORT}`));
