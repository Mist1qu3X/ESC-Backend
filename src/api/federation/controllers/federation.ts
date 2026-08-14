/**
 * federation controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::federation.federation', ({ strapi }) => ({
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
}));
