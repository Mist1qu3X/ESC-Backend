/**
 * doc controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::doc.doc', ({ strapi }) => ({
  // Инкремент счётчика скачиваний. Публичный (config.auth=false в роутере).
  // Правим строки напрямую через db.query, чтобы обновить и draft, и published
  // (фронт читает published) без republish-побочек.
  async incrementDownload(ctx) {
    const { id } = ctx.params;
    const where = /^\d+$/.test(String(id)) ? { id: Number(id) } : { documentId: id };
    const rows = await strapi.db
      .query('api::doc.doc')
      .findMany({ where, select: ['id', 'downloadCount'] });
    if (!rows.length) return ctx.notFound('Document not found');
    let count = 0;
    for (const r of rows) {
      count = (r.downloadCount || 0) + 1;
      await strapi.db
        .query('api::doc.doc')
        .update({ where: { id: r.id }, data: { downloadCount: count } });
    }
    ctx.body = { downloadCount: count };
  },

  // Зеркалирование библиотеки документов с официального сайта. Тело: { docs:[...], dryRun? }.
  // Защищено admin API-токеном (передаётся в заголовке Authorization).
  async syncOfficial(ctx) {
    const body = (ctx.request?.body as any) || {};
    const result = await strapi.service('api::doc.doc').syncOfficialDocs(body);
    ctx.body = result;
  },
}));
