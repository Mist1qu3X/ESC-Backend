/**
 * record controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::record.record', ({ strapi }) => ({
  // Ручной запуск полного переноса рекордов из records.json. Тело: { dryRun? }.
  // Защищено admin API-токеном. Чистит коллекцию и создаёт все записи заново.
  async syncOfficial(ctx) {
    const body = (ctx.request?.body as any) || {};
    ctx.body = await strapi.service('api::record.record').syncOfficial(body);
  },
}));
