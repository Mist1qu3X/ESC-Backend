/**
 * result-detail controller
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::result-detail.result-detail', ({ strapi }) => ({
  // Ручной запуск синхронизации результатов из SIUS (защищено правами роли/токеном).
  async syncSius(ctx) {
    const body = (ctx.request?.body as any) || {};
    const result = await strapi.service('api::result-detail.result-detail').syncFromSius(body);
    ctx.body = result;
  },
}));
