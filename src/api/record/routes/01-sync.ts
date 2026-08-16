/**
 * Кастомный роут: полный перенос официальных рекордов из bundled records.json.
 * POST /api/records/sync-official  (доступ — по admin API-токену)
 * Префикс 01- грузится до core-роутера, чтобы путь матчился раньше /:id.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/records/sync-official',
      handler: 'record.syncOfficial',
      config: { policies: [] },
    },
  ],
};
