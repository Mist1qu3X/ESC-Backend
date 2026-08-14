/**
 * Ручной запуск синхронизации результатов из SIUS.
 * POST /api/result-details/sync-sius  (доступ — по правам роли / admin API-токену)
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/result-details/sync-sius',
      handler: 'result-detail.syncSius',
      config: { policies: [] },
    },
  ],
};
