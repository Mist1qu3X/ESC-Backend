import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      provider: 'aws-s3',
      // Сколько файлов из одной пачки обрабатывать параллельно. Дефолт Strapi — 1:
      // админка шлёт все выбранные фото ОДНИМ запросом, и они ресайзятся и уходят
      // в S3 строго по очереди — отсюда «грузится очень долго и не все».
      // Через env можно снизить без правки кода, если контейнеру не хватит памяти
      // (каждый параллельный файл держит в памяти распакованное изображение).
      concurrentUploadSize: env.int('UPLOAD_CONCURRENCY', 5),
      providerOptions: {
        baseUrl: env('S3_BASE_URL'),
        s3Options: {
          endpoint: env('S3_ENDPOINT'),
          region: env('S3_REGION', 'ru-1'),
          forcePathStyle: env.bool('S3_FORCE_PATH_STYLE', true),
          credentials: {
            accessKeyId: env('S3_ACCESS_KEY_ID'),
            secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
          },
          params: { Bucket: env('S3_BUCKET') },
        },
      },
      actionOptions: { upload: {}, uploadStream: {}, delete: {} },
    },
  },
});

export default config;
