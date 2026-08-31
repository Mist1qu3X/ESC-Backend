/**
 * category controller
 */
import { factories } from '@strapi/strapi';

// as any на UID: свежий content-type ещё не в сгенерированных типах.
export default factories.createCoreController('api::category.category' as any, ({ strapi }) => ({
  // Сид категорий из doc.theme + привязка документов. Admin/full-access токен.
  async syncFromThemes(ctx) {
    const result = await strapi.service('api::category.category' as any).syncFromThemes();
    ctx.body = result;
  },
}));
