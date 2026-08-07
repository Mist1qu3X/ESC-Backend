/**
 * live-stream lifecycles
 *
 * Instant fill of blank title / eventName from YouTube when a record is saved.
 * Ongoing refresh (every 3 min, authoritative) is handled by the cron task in
 * config/server.ts. All YouTube logic lives in the live-stream service.
 */

const isBlank = (v: unknown) => !String(v ?? '').trim();

async function fill(data: any, treatAbsentAsBlank: boolean) {
  if (!data?.url) return;
  if (data.autoSync === false) return; // ручная фиксация — не трогаем title/eventName
  const strapi = (globalThis as any).strapi;
  const svc = strapi.service('api::live-stream.live-stream');
  if (!svc.ytId(data.url)) return; // канал без конкретного видео — нечего резолвить

  // create: отсутствующее поле = пустое (заполняем). update: заполняем только явно очищенное,
  // чтобы не затирать ручное значение при правке других полей.
  const wants = (k: string) => (treatAbsentAsBlank ? isBlank(data[k]) : k in data && isBlank(data[k]));

  const needTitle = wants('title');
  const needEvent = wants('eventName');
  if (!needTitle && !needEvent) return;

  const meta = await svc.fetchMeta(data.url);
  if (needTitle && meta.title) data.title = meta.title;
  if (needEvent && meta.eventName) data.eventName = meta.eventName;
}

export default {
  async beforeCreate(event: any) {
    await fill(event?.params?.data, true);
  },
  async beforeUpdate(event: any) {
    await fill(event?.params?.data, false);
  },
};
