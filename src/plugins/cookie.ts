import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';

export default fp(async (fastify) => {
  await fastify.register(fastifyCookie);
});
