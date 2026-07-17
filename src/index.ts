import type { Core } from '@strapi/strapi';

// Content-types, чей find/findOne должен быть открыт для роли Public.
// Добавлять сюда новые API, к которым фронт ходит без авторизации.
const PUBLIC_READ_APIS = [
  'api::esc-platform.esc-platform',
  'api::partner.partner',
  'api::social-link.social-link',
  'api::core-value.core-value',
  'api::committee.committee',
];

// Исходные названия комитетов — создаются один раз, если коллекция Committee пуста.
// После сида названия можно свободно переименовывать в админке.
const DEFAULT_COMMITTEES = [
  'Technical Committee',
  'Development Committee',
  'Athletes Committee',
  'Judges Committee',
  'Medical Committee',
  'Legal Committee',
];

async function seedCommittees(strapi: Core.Strapi) {
  try {
    const count = await strapi.db.query('api::committee.committee').count();
    if (count > 0) return;

    for (let i = 0; i < DEFAULT_COMMITTEES.length; i++) {
      await strapi.documents('api::committee.committee').create({
        data: { name: DEFAULT_COMMITTEES[i], order: i },
        status: 'published',
      });
    }
    strapi.log.info(`[bootstrap] Seeded ${DEFAULT_COMMITTEES.length} default committees`);
  } catch (e) {
    strapi.log.error(`[bootstrap] seedCommittees failed: ${(e as Error).message}`);
  }
}

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
    await seedCommittees(strapi);
  },
};
