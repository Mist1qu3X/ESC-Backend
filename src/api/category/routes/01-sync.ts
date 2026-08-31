/**
 * Кастомный роут: сид категорий из doc.theme + привязка документов.
 * POST /api/categories/sync-from-themes (admin/full-access токен).
 * Префикс 01- — грузится до core-роутера, чтобы путь матчился раньше /:id.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/categories/sync-from-themes',
      handler: 'category.syncFromThemes',
      config: { policies: [] },
    },
  ],
};
