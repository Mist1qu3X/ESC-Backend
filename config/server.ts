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
      // Раз в сутки (04:00) — чистое зеркало результатов из SIUS: purge+reimport всех стадий.
      // purge срабатывает только если SIUS ответил (защита от обнуления при недоступности).
      'sius-results-sync': {
        task: async ({ strapi }: { strapi: Core.Strapi }) => {
          try {
            const r = await strapi.service('api::result-detail.result-detail').syncFromSius({ purge: true });
            strapi.log.info(`[cron] SIUS daily sync: ${JSON.stringify(r?.competitions ? { matched: r.matched, rows: r.rows } : r)}`);
          } catch (e) {
            strapi.log.error(`[cron] SIUS results sync failed: ${(e as Error).message}`);
          }
        },
        options: { rule: '0 4 * * *' },
      },
      // Каждые 30 минут — лёгкий live-синк идущих сейчас событий (activeOnly, без purge:
      // только upsert, страница не пустеет). Даёт свежие результаты турнира в течение дня,
      // не дожидаясь ночного полного зеркала.
      'sius-live-sync': {
        task: async ({ strapi }: { strapi: Core.Strapi }) => {
          try {
            const r = await strapi.service('api::result-detail.result-detail').syncFromSius({ activeOnly: true });
            strapi.log.info(`[cron] SIUS live sync: ${JSON.stringify({ matched: r?.matched, rows: r?.rows, created: r?.created, updated: r?.updated })}`);
          } catch (e) {
            strapi.log.error(`[cron] SIUS live sync failed: ${(e as Error).message}`);
          }
        },
        options: { rule: '*/30 * * * *' },
      },
    },
  },
});

export default config;
