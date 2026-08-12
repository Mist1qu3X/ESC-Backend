/**
 * Кастомный роут: публичный инкремент счётчика скачиваний документа.
 * PUT /api/docs/:id/download  (:id — documentId или числовой id)
 */

export default {
  routes: [
    {
      method: 'PUT',
      path: '/docs/:id/download',
      handler: 'doc.incrementDownload',
      config: {
        auth: false,
      },
    },
  ],
};
