/**
 * federation controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::federation.federation', ({ strapi }) => ({
  /**
   * Вернуть федерацию текущего пользователя (где он назначен manager).
   * Фильтровать по связи с пользователем через публичный API нельзя (400),
   * поэтому делаем это на сервере по ctx.state.user.
   */
  async mine(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const results = await strapi.documents('api::federation.federation').findMany({
      filters: { manager: { id: user.id } },
      populate: { flag: true },
      limit: 1,
    });
    const fed = results?.[0];
    if (!fed) return ctx.notFound('К вашей учётной записи не привязана федерация.');
    return { data: fed };
  },

  /**
   * Загрузка/замена флага своей федерации.
   * Файл принимается как multipart (поле `flag`) и загружается на сервере —
   * поэтому роли Authenticated НЕ нужно право Upload, достаточно прав на Federation.
   * Владелец проверяется политикой is-own-federation (+ подстраховка ниже).
   */
  async uploadFlag(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const documentId = ctx.params.id;
    const fed = await strapi.documents('api::federation.federation').findOne({
      documentId,
      populate: { manager: true },
    });
    if (!(fed?.manager && fed.manager.id === user.id)) return ctx.forbidden();

    const files = (ctx.request as any).files || {};
    const file = files.flag || files.files;
    if (!file) return ctx.badRequest('Файл флага не передан (поле "flag").');

    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: {},
      files: file,
    });
    const flagId = uploaded?.[0]?.id;
    if (!flagId) return ctx.badRequest('Не удалось загрузить файл.');

    await strapi.documents('api::federation.federation').update({
      documentId,
      data: { flag: flagId },
    });

    return { ok: true, flag: uploaded[0] };
  },

  /**
   * Массовая установка Secretary General (только по admin/full-access токену).
   * Body: { items: [{ documentId, secretaryGeneral }] }. Кастомный роут без
   * is-own-federation, пишем напрямую в published. Для импорта/тестовых данных.
   */
  async bulkSetSecretaries(ctx) {
    const body = (ctx.request?.body as any) || {};
    const items = Array.isArray(body.items) ? body.items : [];
    let updated = 0;
    const errors: string[] = [];
    for (const it of items) {
      const documentId = it?.documentId;
      const secretaryGeneral = it?.secretaryGeneral;
      if (!documentId || typeof secretaryGeneral !== 'string') {
        errors.push(`bad item: ${JSON.stringify(it).slice(0, 60)}`);
        continue;
      }
      try {
        await strapi.documents('api::federation.federation').update({
          documentId,
          data: { secretaryGeneral },
          status: 'published',
        });
        updated++;
      } catch (e) {
        errors.push(`${documentId}: ${(e as Error).message}`);
      }
    }
    ctx.body = { updated, total: items.length, errors: errors.slice(0, 20) };
  },
}));
