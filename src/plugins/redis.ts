// This plugin decorates fastify with a `redis` client.
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createRedisClient } from '../lib/redis.js';

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redis = createRedisClient();

  redis.on('error', (err) => {
    fastify.log.error({ err }, 'redis error');
  });

  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit(); // quit() is much safer than close()
  });
};

export default fp(redisPlugin);
