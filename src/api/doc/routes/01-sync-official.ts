/**
 * Кастомный роут: зеркалирование библиотеки документов с официального сайта.
 * POST /api/docs/sync-official  (доступ — по admin API-токену)
 * Префикс 01- гарантирует загрузку до core-роутера, чтобы путь матчился раньше /:id.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/docs/sync-official',
      handler: 'doc.syncOfficial',
      config: { policies: [] },
    },
  ],
};
