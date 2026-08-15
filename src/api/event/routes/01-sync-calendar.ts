/**
 * Кастомный роут: импорт недостающих событий календаря с офиц. сайта.
 * POST /api/events/sync-calendar  (доступ — по admin API-токену)
 * Префикс 01- грузится до core-роутера, чтобы путь матчился раньше /:id.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/events/sync-calendar',
      handler: 'event.syncCalendar',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/events/sync-event-docs',
      handler: 'event.syncEventDocs',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/events/sync-schedules',
      handler: 'event.syncSchedules',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/events/sync-event-results',
      handler: 'event.syncEventResults',
      config: { policies: [] },
    },
  ],
};
