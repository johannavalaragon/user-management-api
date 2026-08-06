import { join } from 'node:path';
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload';
import { FastifyPluginAsync, FastifyServerOptions } from 'fastify';
import { config } from './config.js';

// replacement for CJS-only __dirname
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedisClient } from './lib/redis.js';

// Tell TypeScript that fastify now has a global .io superpower
declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AppOptions
  extends FastifyServerOptions, Partial<AutoloadPluginOptions> {}

const options: AppOptions = {
  ajv: { customOptions: { removeAdditional: false } },
};

const app: FastifyPluginAsync<AppOptions> = async (
  fastify,
  opts,
): Promise<void> => {
  // Create the two special Redis connections for the Adapter
  const pubClient = createRedisClient();
  const subClient = pubClient.duplicate();

  // Wait for them to connect
  await Promise.all([pubClient.connect(), subClient.connect()]);

  // Attach Socket.io to our Fastify Server
  const io = new Server(fastify.server, {
    adapter: createAdapter(pubClient, subClient),
    cors: { origin: '*' }, // Allow the frontend to connect
  });

  fastify.decorate('io', io);

  // When a user views a Question Results page, they join a "room" to listen for live updates
  io.on('connection', (socket) => {
    // --- FEATURE 1: LIVE VIEWER COUNT ---
    const updateViewerCount = (roomId: string) => {
      // Get how many sockets are in this specific room
      const room = io.sockets.adapter.rooms.get(roomId);
      const count = room ? room.size : 0;
      io.to(roomId).emit('activeViewers', count);
    };

    const joinRoom = (questionId: string | number) => {
      const id = String(questionId);
      socket.join(id);
      socket.join(`question:${id}`);

      // Tell everyone in the room the new viewer count!
      updateViewerCount(id);
    };

    socket.on('subscribe', joinRoom);
    socket.on('join', joinRoom);
    socket.on('joinRoom', joinRoom);

    // When someone leaves, update the count for the rooms they were in
    socket.on('disconnecting', () => {
      socket.rooms.forEach((room) => {
        if (room !== socket.id) {
          // Calculate size minus the person leaving
          const count = (io.sockets.adapter.rooms.get(room)?.size || 1) - 1;
          io.to(room).emit('activeViewers', count);
        }
      });
    });

    // --- FEATURE 2: LIVE EMOJI REACTIONS ---
    socket.on(
      'sendReaction',
      (data: { questionId: string | number; emoji: string }) => {
        // Broadcast the emoji to everyone looking at this question
        io.to(String(data.questionId)).emit('receiveReaction', data.emoji);
      },
    );
  });

  // Safely close the connections when the server shuts down
  fastify.addHook('onClose', async () => {
    io.close();
    await pubClient.quit();
    await subClient.quit();
  });

  // This loads all plugins defined in plugins
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    options: opts,
  });

  // This loads all plugins defined in routes
  void fastify.register(
    async (scoped) => {
      void scoped.register(AutoLoad, {
        dir: join(__dirname, 'routes'),
        options: opts,
      });
    },
    { prefix: config.routes.api_prefix },
  );
};

export default app;
export { app, options };
