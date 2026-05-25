import { Hono } from 'hono';
import { listDetailedModels, listPublicModels } from '../services/model-registry.js';
import type { AppEnv } from '../types/app.js';

export const modelsRouter = new Hono<AppEnv>();

modelsRouter.get('/v1/models', async (c) => {
  const models = await listPublicModels();
  return c.json({
    object: 'list',
    data: models
  });
});

modelsRouter.get('/v1/router/models', async (c) => {
  return c.json({
    object: 'list',
    data: await listDetailedModels()
  });
});
