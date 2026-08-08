/**
 * `is-own-federation` policy.
 *
 * Разрешает изменение федерации только тому пользователю, чья связь `federation`
 * указывает на эту же запись. Реализует row-level права для роли «Federation admin»
 * (в Strapi CE нативных row-level прав нет). Вешается на action `update` роутера федераций.
 */

export default async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false; // только аутентифицированные

  const targetDocumentId = policyContext.params?.id; // в Strapi 5 :id === documentId
  if (!targetDocumentId) return false;

  const me = await strapi.documents('plugin::users-permissions.user').findOne({
    documentId: user.documentId,
    populate: { federation: true },
  });

  return Boolean(me?.federation && me.federation.documentId === targetDocumentId);
};
