import { createClient } from 'redis';
import { config } from '../config.js';

// Declare that fastify.redis has the same type as what createClient returns
declare module 'fastify' {
  interface FastifyInstance {
    redis: ReturnType<typeof createClient>;
  }
}

/* Create a new Redis client that connects to the configured Redis
 * server and database
 */
export function createRedisClient() {
  return createClient({
    url: `redis://${config.redis?.host}:${config.redis?.port}/${config.redis?.db}`,
  });
}
