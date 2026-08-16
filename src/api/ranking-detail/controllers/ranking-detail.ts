/**
 * ranking-detail controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::ranking-detail.ranking-detail', ({ strapi }) => ({
  // Ручной запуск полного переноса рейтинга из rankings.json. Тело: { dryRun? }.
  // Защищено admin API-токеном. Чистит коллекцию и создаёт все записи заново.
  async syncOfficial(ctx) {
    const body = (ctx.request?.body as any) || {};
    ctx.body = await strapi.service('api::ranking-detail.ranking-detail').syncOfficial(body);
  },
}));
