import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      // Медиа хранятся локально в public/uploads — в Dokploy туда смонтирован Hetzner Volume.
      provider: 'local',
      // Сколько файлов из одной пачки обрабатывать параллельно. Дефолт Strapi — 1:
      // админка шлёт все выбранные фото ОДНИМ запросом, и они ресайзятся и сохраняются
      // строго по очереди — отсюда «грузится очень долго и не все».
      // Через env можно снизить без правки кода, если контейнеру не хватит памяти
      // (каждый параллельный файл держит в памяти распакованное изображение).
      concurrentUploadSize: env.int('UPLOAD_CONCURRENCY', 5),
      // xlarge — для фоновых «героев» на всю ширину экрана; оригиналы (3–5 тыс. px, 1–3 МБ)
      // сайт больше не показывает, они остаются только как исходник.
      breakpoints: { xlarge: 1920, large: 1000, medium: 750, small: 500 },
      providerOptions: {
        // Cache-Control для /uploads/*. Не immutable: «Replace media» в админке
        // сохраняет прежний URL файла, поэтому кэш ограничен сутками.
        localServer: { maxage: 24 * 60 * 60 * 1000 },
      },
    },
  },
});

export default config;
