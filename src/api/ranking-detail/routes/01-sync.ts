/**
 * Кастомный роут: полный перенос официального рейтинга из bundled rankings.json.
 * POST /api/ranking-details/sync-official  (доступ — по admin API-токену)
 * Префикс 01- грузится до core-роутера, чтобы путь матчился раньше /:id.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/ranking-details/sync-official',
      handler: 'ranking-detail.syncOfficial',
      config: { policies: [] },
    },
  ],
};
