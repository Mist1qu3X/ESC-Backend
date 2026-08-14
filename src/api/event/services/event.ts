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
import fs from 'fs';
import os from 'os';
import path from 'path';

const SITE = 'https://esc-shooting.org';
const UID = 'api::event.event';

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const mimeOf = (fn: string) => EXT_MIME[(fn.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
const hashStr = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); };

async function uploadUrl(strapi: any, url: string, filename: string): Promise<number | null> {
  const res = await fetch(SITE + url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const clean = filename.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'file';
  const tmp = path.join(os.tmpdir(), `escev_${Date.now()}_${hashStr(url)}_${clean.replace(/[^\w.\-]+/g, '_')}`);
  fs.writeFileSync(tmp, buf);
  try {
    const up = await strapi.plugin('upload').service('upload').upload({
      data: {}, files: { filepath: tmp, originalFilename: clean, mimetype: mimeOf(filename), size: buf.length },
    });
    return up?.[0]?.id ?? null;
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

// Парсим секцию DOCUMENTS карточки события → [{url, filename, label, size}].
function parseEventDocs(htmlText: string): { url: string; filename: string; label: string; size: string }[] {
  const m = htmlText.match(/<h3[^>]*>\s*DOCUMENTS\s*<\/h3>([\s\S]*?)(?:<h3|<\/section|<footer|Sign up)/);
  if (!m) return [];
  const out: any[] = [];
  for (const row of m[1].split('<tr>').slice(1)) {
    const a = row.match(/<a href='(\/storage\/[^']+)'[^>]*class='i'[^>]*download='([^']*)'[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const label = a[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
    const sz = row.match(/file_size'>([^<]+)</);
    out.push({ url: a[1], filename: a[2].replace(/&amp;/g, '&'), label, size: sz ? sz[1].trim() : '' });
  }
  return out;
}

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

  // Импорт документов события (секция DOCUMENTS карточки) в repeatable-компонент event.documents.
  // Резюмируемо: onlyMissing (по умолч.) пропускает события, где документы уже есть. Батчами maxEvents.
  async syncEventDocs(opts: { dryRun?: boolean; maxEvents?: number; onlyMissing?: boolean } = {}) {
    const dryRun = !!opts.dryRun;
    const maxEvents = opts.maxEvents ?? 30;
    const onlyMissing = opts.onlyMissing !== false;

    // авторитетные slug'и из sitemap (для точного URL карточки)
    const sm = await sget(`${SITE}/sitemap.xml/calendar_events`);
    const slugById = new Map<number, string>();
    for (const m of sm.matchAll(/\/calendar\/view\/(\d+)-([^<\s]+)/g)) slugById.set(+m[1], m[2]);

    // Только опубликованные версии (db.query иначе вернёт и draft, и published — двойной счёт).
    const events: any[] = await strapi.db
      .query(UID)
      .findMany({ where: { publishedAt: { $notNull: true } }, select: ['id', 'documentId', 'slug', 'docsChecked'], limit: 5000 });
    const withId = events
      .map((e) => ({ e, id: +(((e.slug || '').match(/-(\d+)$/) || [])[1] || 0) }))
      .filter((x) => x.id && slugById.has(x.id));
    const queue = withId
      .filter((x) => !(onlyMissing && x.e.docsChecked)) // docsChecked = уже обработано (даже если документов нет)
      .sort((a, b) => b.id - a.id); // сначала новые (у них чаще есть документы)

    let processed = 0, filled = 0, skipped = 0, filesUp = 0, errors = 0;
    const done: string[] = [];
    const errs: string[] = [];

    for (const { e, id } of queue.slice(0, maxEvents)) {
      processed++;
      const html = await sget(`${SITE}/calendar/view/${id}-${slugById.get(id)}`);
      if (!html) { errors++; errs.push(`${id}: fetch failed`); continue; }
      // Перепроверка полей события по INFORMATION (Phase D): дисциплина, место, даты — 1:1 с сайтом.
      const info = parseEvent(html);
      const dts = (info['date'] || '').split('-').map((s) => s.trim());
      const di = dmyToIso(dts[0] || '');
      const ei = dmyToIso(dts[1] || dts[0] || '');
      const loc = [info['city'], info['country']].filter(Boolean).join(', ');
      const fieldUpd: any = {};
      if (info['discipline']) fieldUpd.disciplines = info['discipline'];
      if (loc) fieldUpd.location = loc;
      if (di) fieldUpd.date = di;
      if (ei) fieldUpd.endDate = ei;

      const files = parseEventDocs(html);
      if (dryRun) { if (files.length) { filled++; filesUp += files.length; } else skipped++; continue; }
      if (!files.length) {
        await strapi.documents(UID).update({ documentId: e.documentId, data: { ...fieldUpd, docsChecked: true }, status: 'published' });
        skipped++;
        continue;
      }
      const comps: any[] = [];
      for (const f of files) {
        try {
          const fid = await uploadUrl(strapi, f.url, f.filename);
          if (fid) { comps.push({ name: f.label || f.filename, fileSize: f.size, file: fid }); filesUp++; }
        } catch (er) { errs.push(`${id}/${f.label}: ${(er as Error).message}`); }
      }
      // docsChecked=true в любом случае — событие обработано, не гоняем повторно
      await strapi.documents(UID).update({ documentId: e.documentId, data: { ...fieldUpd, documents: comps, docsChecked: true }, status: 'published' });
      if (comps.length) { filled++; done.push(`${id} (${comps.length} docs)`); } else skipped++;
    }

    const remaining = Math.max(0, queue.length - maxEvents);
    const summary = { totalEvents: withId.length, queued: queue.length, processed, filled, skipped, filesUploaded: filesUp, errors, remaining };
    strapi.log.info(`[event-docs] sync: ${JSON.stringify(summary)}`);
    return { ...summary, done: done.slice(0, 60), errs: errs.slice(0, 20) };
  },
}));
