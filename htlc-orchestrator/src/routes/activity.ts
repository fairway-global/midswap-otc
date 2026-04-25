import type { FastifyPluginAsync } from 'fastify';
import type { OtcStore } from '../db.js';

export const activityRoutes =
  (store: OtcStore): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { rfqId: string } }>('/activity/:rfqId', async (req, reply) => {
      const activities = store.listActivity(req.params.rfqId);
      return reply.send({ activities });
    });
  };
