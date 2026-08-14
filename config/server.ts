import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: true,
    tasks: {
      // Каждые 3 минуты подтягиваем title + eventName трансляций из YouTube.
      'live-stream-youtube-sync': {
        task: async ({ strapi }: { strapi: Core.Strapi }) => {
          try {
            await strapi.service('api::live-stream.live-stream').syncFromYouTube();
          } catch (e) {
            strapi.log.error(`[cron] live-stream sync failed: ${(e as Error).message}`);
          }
        },
        options: { rule: '*/3 * * * *' },
      },
      // Раз в сутки подтягиваем результаты европейских соревнований из SIUS.
      'sius-results-sync': {
        task: async ({ strapi }: { strapi: Core.Strapi }) => {
          try {
            await strapi.service('api::result-detail.result-detail').syncFromSius();
          } catch (e) {
            strapi.log.error(`[cron] SIUS results sync failed: ${(e as Error).message}`);
          }
        },
        options: { rule: '0 4 * * *' },
      },
    },
  },
});

export default config;
