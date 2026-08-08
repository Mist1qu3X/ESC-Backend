/**
 * `is-own-federation` policy.
 *
 * Разрешает изменение федерации только пользователю, назначенному её `manager`.
 * Реализует row-level права для роли «Federation admin» (в Strapi CE нативных
 * row-level прав нет). Вешается на action `update` роутера федераций.
 */

export default async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false; // только аутентифицированные

  const targetDocumentId = policyContext.params?.id; // в Strapi 5 :id === documentId
  if (!targetDocumentId) return false;

  const fed = await strapi.documents('api::federation.federation').findOne({
    documentId: targetDocumentId,
    populate: { manager: true },
  });

  return Boolean(fed?.manager && fed.manager.id === user.id);
};
