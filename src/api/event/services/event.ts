/**
 * event service
 *
 * Импорт недостающих событий календаря с официального сайта esc-shooting.org.
 * Официальный сайт закрывается — это разовая/периодическая полная миграция календаря в наши Events,
 * пока сайт жив. Источник: sitemap /sitemap.xml/calendar_events (полный список), затем карточка
 * каждого события /calendar/view/{id}-{slug} парсится в поля Event. Добавляем только отсутствующие
 * (по числовому id в конце slug). Вызов: POST /api/events/sync-calendar.
 */
import { factories } from '@strapi/strapi';

const SITE = 'https://esc-shooting.org';
const UID = 'api::event.event';

async function sget(url: string): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.ok ? await r.text() : '';
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

const strip = (s = '') => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim();
const dmyToIso = (s: string): string | null => {
  const m = (s || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Тип события выводим из названия (на сайте label всегда "Competition").
function inferType(name: string): 'competition' | 'education' | 'meeting' {
  const n = (name || '').toLowerCase();
  if (/course|seminar|technician|coach|academy|workshop|clinic|training camp|lms/.test(n)) return 'education';
  if (/meeting|assembly|congress|presidium|committee|forum|symposium/.test(n)) return 'meeting';
  return 'competition';
}
function inferCategory(name: string): string {
  const n = (name || '').toLowerCase();
  if (/u-?23|u-?21|u-?18|u-?16|junior|youth|cadet|eyof/.test(n)) return 'JUNIOR';
  return 'SENIOR';
}

// Парсим INFORMATION-блок карточки события.
function parseEvent(htmlText: string): Record<string, string> {
  const info: Record<string, string> = {};
  const block = htmlText.match(/class="information">([\s\S]*?)<\/ul>/);
  if (block) {
    for (const li of block[1].match(/<li>[\s\S]*?<\/li>/g) || []) {
      const b = li.match(/<b>([\s\S]*?)<\/b>/);
      const sp = li.match(/<span>([\s\S]*?)<\/span>/);
      if (b) info[strip(b[1]).toLowerCase()] = sp ? strip(sp[1]) : '';
    }
  }
  const h1 = htmlText.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (h1) info['__h1'] = strip(h1[1]);
  return info;
}

export default factories.createCoreService(UID, ({ strapi }) => ({
  async syncCalendar(opts: { dryRun?: boolean; maxNew?: number } = {}) {
    const dryRun = !!opts.dryRun;
    const maxNew = opts.maxNew ?? 1000;

    // 1) Полный список событий календаря из sitemap
    const sm = await sget(`${SITE}/sitemap.xml/calendar_events`);
    const pairs = [...sm.matchAll(/\/calendar\/view\/(\d+)-([^<\s]+)/g)].map((m) => ({ id: +m[1], slug: m[2] }));
    const byId = new Map<number, string>();
    pairs.forEach((p) => byId.set(p.id, p.slug));

    // 2) Уже существующие у нас id (из числового суффикса slug)
    const existing: any[] = await strapi.db.query(UID).findMany({ select: ['slug'], limit: 5000 });
    const haveIds = new Set<number>();
    existing.forEach((e) => { const m = (e.slug || '').match(/-(\d+)$/); if (m) haveIds.add(+m[1]); });

    const missing = [...byId.keys()].filter((id) => !haveIds.has(id)).sort((a, b) => a - b);
    const summary = { sitemap: byId.size, existing: existing.length, missing: missing.length, created: 0, skipped: 0, errors: 0 };
    const createdList: string[] = [];
    const errorList: string[] = [];

    if (dryRun) {
      strapi.log.info(`[calendar] dryRun: ${JSON.stringify(summary)} missing=${missing.join(',')}`);
      return { ...summary, missingIds: missing };
    }

    const now = Date.now();
    for (const id of missing.slice(0, maxNew)) {
      const slug = byId.get(id)!;
      const html = await sget(`${SITE}/calendar/view/${id}-${slug}`);
      if (!html) { summary.errors++; errorList.push(`${id}: fetch failed`); continue; }
      const info = parseEvent(html);
      const name = info['competition'] || info['education'] || info['meeting'] || info['__h1'] || '';
      const dates = (info['date'] || '').split('-').map((s) => s.trim());
      const dateIso = dmyToIso(dates[0] || '');
      const endIso = dmyToIso(dates[1] || dates[0] || '');
      const country = info['country'] || '';
      const city = info['city'] || '';
      const location = [city, country].filter(Boolean).join(', ') || country || 'TBD';
      if (!name || !dateIso || !endIso) { summary.errors++; errorList.push(`${id}: incomplete (name/date)`); continue; }

      const data: any = {
        name,
        slug: `${slug}-${id}`,
        type: inferType(name),
        statusEvent: new Date(endIso).getTime() < now ? 'FINISHED' : 'UPCOMING',
        category: inferCategory(name),
        date: dateIso,
        endDate: endIso,
        location,
        disciplines: info['discipline'] || null,
        resultsPending: false,
      };
      try {
        await strapi.documents(UID).create({ data, status: 'published' });
        summary.created++;
        createdList.push(`${id} ${name} (${dateIso})`);
      } catch (e) {
        summary.errors++;
        errorList.push(`${id}: ${(e as Error).message}`);
      }
    }

    strapi.log.info(`[calendar] sync: ${JSON.stringify(summary)}`);
    if (errorList.length) strapi.log.warn(`[calendar] errors: ${errorList.slice(0, 15).join(' | ')}`);
    return { ...summary, createdList, errorList: errorList.slice(0, 40) };
  },
}));
