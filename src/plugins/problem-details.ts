import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { normalizeProblemDetailsError } from '../lib/problem_details.js';

// Installs a shared error handler that emits RFC 7807 Problem Details
// responses (application/problem+json):
// https://datatracker.ietf.org/doc/html/rfc7807
const problemDetailsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    // Normalize Fastify/AJV/httpErrors/custom throws into one canonical shape.
    const { problem, headers } = normalizeProblemDetailsError(
      error,
      request.url,
    );

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        reply.header(key, value);
      }
    }

    // Send the RFC 7807 payload with the matching HTTP status.
    reply.code(problem.status).type('application/problem+json').send(problem);
  });
};

export default fp(problemDetailsPlugin, {
  name: 'problem-details',
});
