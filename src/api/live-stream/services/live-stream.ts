/**
 * live-stream service
 *
 * YouTube metadata sync (no API key, server-side => no CORS):
 *   - title     <- oEmbed
 *   - eventName <- first non-empty line of the video description (watch page)
 *
 * Used by the content-type lifecycle (fill blanks on save) and by the cron task
 * in config/server.ts (refresh every 3 minutes).
 */

import { factories } from '@strapi/strapi';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// videoId из разных форм YouTube-ссылки (watch / youtu.be / live / embed / shorts)
export function ytId(url: string): string | null {
  const m = String(url || '').match(
    /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T | null>,
  ms = 6000
): Promise<T | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fn(c.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Название ролика через oEmbed (стабильный эндпоинт, без ключа).
async function fetchTitle(url: string): Promise<string | null> {
  const id = ytId(url);
  if (!id) return null;
  return withTimeout(async (signal) => {
    const ep =
      'https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id) +
      '&format=json';
    const res = await fetch(ep, { signal });
    if (!res.ok) return null;
    const data: any = await res.json();
    const t = typeof data?.title === 'string' ? data.title.trim() : '';
    return t || null;
  });
}

// eventName = первая непустая строка описания. Описание oEmbed не отдаёт —
// парсим shortDescription со страницы просмотра (server-side, без ключа).
async function fetchEventName(url: string): Promise<string | null> {
  const id = ytId(url);
  if (!id) return null;
  return withTimeout(async (signal) => {
    const res = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en', {
      signal,
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': UA,
        Cookie: 'CONSENT=YES+1', // без этого EU-IP может получить consent-заглушку
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    let desc: string;
    try {
      desc = JSON.parse('"' + m[1] + '"'); // снимаем JSON-экранирование (\n, \", \uXXXX)
    } catch {
      return null;
    }
    const first = desc.split('\n').map((s) => s.trim()).find(Boolean);
    return first || null;
  });
}

// Обе метки за один вызов.
async function fetchMeta(
  url: string
): Promise<{ title: string | null; eventName: string | null }> {
  if (!ytId(url)) return { title: null, eventName: null };
  const [title, eventName] = await Promise.all([fetchTitle(url), fetchEventName(url)]);
  return { title, eventName };
}

export default factories.createCoreService('api::live-stream.live-stream', ({ strapi }) => ({
  ytId,
  fetchMeta,

  // Cron: обновляем title + eventName у всех записей с YouTube-видео.
  // YouTube — источник истины, поэтому перезаписываем (обновляем только при изменении).
  async syncFromYouTube() {
    const rows: any[] = await strapi.db.query('api::live-stream.live-stream').findMany({
      where: { url: { $notNull: true } },
      select: ['id', 'url', 'title', 'eventName', 'autoSync'],
    });

    // Только записи с включённым автосинком (autoSync !== false) и YouTube-видео.
    // autoSync === false => значение зафиксировано вручную, не трогаем.
    const eligible = rows.filter((r) => r.autoSync !== false && ytId(r.url));

    // тянем YouTube один раз на уникальный url (draft+published делят один url)
    const urls = [...new Set(eligible.map((r) => r.url))];
    const metaByUrl = new Map<string, { title: string | null; eventName: string | null }>();
    for (const url of urls) {
      metaByUrl.set(url, await fetchMeta(url));
    }

    let updated = 0;
    for (const row of eligible) {
      const meta = metaByUrl.get(row.url);
      if (!meta) continue;
      const data: any = {};
      if (meta.title && meta.title !== row.title) data.title = meta.title;
      if (meta.eventName && meta.eventName !== row.eventName) data.eventName = meta.eventName;
      if (!Object.keys(data).length) continue;
      // Одна битая запись не должна прерывать весь прогон.
      try {
        await strapi.db
          .query('api::live-stream.live-stream')
          .update({ where: { id: row.id }, data });
        updated++;
      } catch (e) {
        strapi.log.warn(
          `[live-stream] sync update failed for id=${row.id}: ${(e as Error).message}`
        );
      }
    }
    if (updated) {
      strapi.log.info(
        `[live-stream] YouTube sync: updated ${updated} of ${eligible.length} eligible row(s)`
      );
    }
    return { rows: rows.length, eligible: eligible.length, urls: urls.length, updated };
  },
}));
