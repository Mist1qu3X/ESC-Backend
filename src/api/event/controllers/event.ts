/**
 * event controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::event.event', ({ strapi }) => ({
  // Импорт недостающих событий календаря с офиц. сайта. Тело: { dryRun?, maxNew? }.
  // Защищено admin API-токеном.
  async syncCalendar(ctx) {
    const body = (ctx.request?.body as any) || {};
    const result = await strapi.service('api::event.event').syncCalendar(body);
    ctx.body = result;
  },
}));
