/**
 * Кастомный маршрут для загрузки флага своей федерации (без права Upload у роли).
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/federations/mine',
      handler: 'federation.mine',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/federations/:id/flag',
      handler: 'federation.uploadFlag',
      config: {
        policies: ['api::federation.is-own-federation'],
      },
    },
    {
      // Массовая установка Secretary General (admin/full-access токен). Статичный
      // путь до core /:id, поэтому 01-префикс роутера — матчится раньше.
      method: 'POST',
      path: '/federations/set-secretaries',
      handler: 'federation.bulkSetSecretaries',
      config: { policies: [] },
    },
  ],
};
