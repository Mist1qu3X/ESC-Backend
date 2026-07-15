import type { Core } from '@strapi/strapi';

// Content-types, чей find/findOne должен быть открыт для роли Public.
// Добавлять сюда новые API, к которым фронт ходит без авторизации.
const PUBLIC_READ_APIS = [
  'api::esc-platform.esc-platform',
  'api::partner.partner',
  'api::social-link.social-link',
  'api::core-value.core-value',
];

async function enablePublicRead(strapi: Core.Strapi) {
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) return;

  for (const uid of PUBLIC_READ_APIS) {
    for (const action of ['find', 'findOne']) {
      const permAction = `${uid}.${action}`;
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: permAction, role: publicRole.id } });

      if (!existing) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: { action: permAction, role: publicRole.id },
        });
        strapi.log.info(`[bootstrap] Public read enabled: ${permAction}`);
      }
    }
  }
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await enablePublicRead(strapi);
  },
};
