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
  ],
};
