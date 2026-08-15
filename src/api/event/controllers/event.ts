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

  // Импорт документов событий (секция DOCUMENTS карточки) в event.documents. Тело: { maxEvents?, dryRun?, onlyMissing? }.
  async syncEventDocs(ctx) {
    const body = (ctx.request?.body as any) || {};
    const result = await strapi.service('api::event.event').syncEventDocs(body);
    ctx.body = result;
  },

  // Заполнение расписания событий из schedules.json. Тело: { dryRun? }.
  async syncSchedules(ctx) {
    const body = (ctx.request?.body as any) || {};
    const result = await strapi.service('api::event.event').syncSchedules(body);
    ctx.body = result;
  },

  // Привязка result-book к событиям. Тело: { maxEvents?, dryRun? }.
  async syncEventResults(ctx) {
    const body = (ctx.request?.body as any) || {};
    const result = await strapi.service('api::event.event').syncEventResults(body);
    ctx.body = result;
  },

  // Пересчёт флагов hasResults / hasResultBook (для ленивой загрузки страницы Results).
  async refreshResultFlags(ctx) {
    ctx.body = await strapi.service('api::event.event').refreshEventResultFlags();
  },
}));
