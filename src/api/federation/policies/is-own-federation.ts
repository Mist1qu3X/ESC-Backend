/**
 * `is-own-federation` policy.
 *
 * Разрешает изменение федерации только пользователю, назначенному её `manager`.
 * Реализует row-level права для роли «Federation admin» (в Strapi CE нативных
 * row-level прав нет). Вешается на action `update` роутера федераций.
 *
 * Дополнительно ограничивает НАБОР редактируемых полей: администратор федерации
 * может менять только «свою информацию», а структурные поля (code, region,
 * country, manager и т.д.) остаются за суперадмином.
 */

// Поля, которые администратору федерации разрешено менять с фронта
const EDITABLE_FIELDS = ['name', 'president', 'secretaryGeneral', 'email', 'phone', 'website', 'flag'];

export default async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false; // только аутентифицированные

  const targetDocumentId = policyContext.params?.id; // в Strapi 5 :id === documentId
  if (!targetDocumentId) return false;

  const fed = await strapi.documents('api::federation.federation').findOne({
    documentId: targetDocumentId,
    populate: { manager: true },
  });

  if (!(fed?.manager && fed.manager.id === user.id)) return false;

  // Оставляем в теле запроса только разрешённые поля
  const data = policyContext.request?.body?.data;
  if (data && typeof data === 'object') {
    policyContext.request.body.data = Object.fromEntries(
      Object.entries(data).filter(([key]) => EDITABLE_FIELDS.includes(key)),
    );
  }

  return true;
};
