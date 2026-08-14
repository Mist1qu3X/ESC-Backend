/**
 * Кастомный маршрут для загрузки флага своей федерации (без права Upload у роли).
 */
export default {
  routes: [
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
