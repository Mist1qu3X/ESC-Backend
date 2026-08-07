/**
 * contact-message controller
 *
 * Public `create` (enable Public role -> create in admin). We override create to
 * validate input, whitelist fields and swallow honeypot hits — never trust the
 * client to only send name/email/message.
 */

import { factories } from '@strapi/strapi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default factories.createCoreController(
  'api::contact-message.contact-message',
  ({ strapi }) => ({
    async create(ctx) {
      const body = (ctx.request.body && (ctx.request.body as any).data) || {};

      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim();
      const message = String(body.message || '').trim();

      // Honeypot: real users leave `company` empty; bots fill every field.
      // Pretend success without storing anything.
      if (String(body.company || '').trim()) {
        return ctx.send({ ok: true });
      }

      if (!name || !email || !message) {
        return ctx.badRequest('name, email and message are required');
      }
      if (!EMAIL_RE.test(email)) {
        return ctx.badRequest('invalid email');
      }

      const entity = await strapi
        .documents('api::contact-message.contact-message')
        .create({
          data: {
            name: name.slice(0, 200),
            email: email.slice(0, 200),
            message: message.slice(0, 5000),
            source: String(body.source || 'contact').slice(0, 50),
            handled: false,
          },
        });

      // Minimal response — don't echo stored data back to the public.
      return ctx.send({ ok: true, id: entity.documentId });
    },
  })
);
