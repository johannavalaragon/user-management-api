import { FastifyPluginAsync } from 'fastify';
import { createClient } from 'redis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: ReturnType<typeof createClient>;
  }
}

const MOCK_QUESTIONS = [
  {
    id: 1,
    question: 'What is your favorite programming language?',
    description: 'A test question to prove Redis caching works.',
    createdAt: new Date(),
    choices: [
      { id: 1, description: 'TypeScript' },
      { id: 2, description: 'Python' },
      { id: 3, description: 'Java' },
    ],
  },
];

const MOCK_RESULTS = [
  { choice: 1, count: 5 },
  { choice: 2, count: 3 },
  { choice: 3, count: 2 },
];

const questionapi: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    return { questions: MOCK_QUESTIONS, count: MOCK_QUESTIONS.length };
  });

  fastify.get<{ Params: { id: number } }>('/:id', async (req, res) => {
    const q = MOCK_QUESTIONS.find((q) => q.id === Number(req.params.id));
    if (!q) return res.status(404).send({ message: 'Question not found' });
    return q;
  });

  fastify.get<{ Params: { id: number } }>('/:id/results', async (req) => {
    const cacheKey = `question:${req.params.id}:results`;

    const cachedResults = await fastify.redis.get(cacheKey);
    if (cachedResults) {
      return JSON.parse(cachedResults);
    }

    const results = MOCK_RESULTS;

    await fastify.redis.set(cacheKey, JSON.stringify(results));

    return results;
  });

  fastify.post<{ Params: { id: number }; Body: { choice: number } }>(
    '/:id/vote',
    async (req) => {
      // Tally the new vote in our mock database
      const result = MOCK_RESULTS.find(
        (r) => r.choice === Number(req.body.choice),
      );
      if (result) {
        result.count += 1;
      } else {
        MOCK_RESULTS.push({ choice: Number(req.body.choice), count: 1 });
      }

      // New vote was cast
      await fastify.redis.del(`question:${req.params.id}:results`);

      // --- PHASE 3: THE NUCLEAR BROADCAST ---
      const possibleEvents = ['update', 'results', 'newVote', 'vote', 'voteUpdate', 'questionUpdate'];

      possibleEvents.forEach(event => {
        // Send to the specific rooms
        fastify.io.to(String(req.params.id)).to(`question:${req.params.id}`).emit(event, MOCK_RESULTS);

        // Nuke approach: Send to EVERYONE connected, regardless of what room they are in!
        fastify.io.emit(event, MOCK_RESULTS);
      });

      return { message: 'vote recorded successfully' };
    },
  );
};
export default questionapi;
