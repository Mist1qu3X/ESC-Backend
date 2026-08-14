/**
 * doc service
 *
 * Зеркалирование библиотеки документов с официального сайта esc-shooting.org.
 * Принимает готовый инвентарь (title/theme/date/description/files[]), скачивает файлы,
 * заливает в медиатеку Strapi, upsert документа по externalId, затем удаляет все
 * библиотечные документы (eventSlug пустой), которых нет в инвентаре — точное зеркало.
 * Вызывается роутом POST /api/docs/sync-official.
 */
import { factories } from '@strapi/strapi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bundledInventory from '../official-inventory.json';

const UID = 'api::doc.doc';

type InFile = { url: string; filename: string; label: string; size: string; mime: string };
type InDoc = { externalId: string; theme: string; title: string; date: string | null; description: string; fileSize: string; files: InFile[] };

const kebab = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 70);
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
};

async function uploadFromUrl(strapi: any, f: InFile): Promise<number | null> {
  const res = await fetch(f.url);
  if (!res.ok) {
    strapi.log.error(`[docs] download failed ${res.status} ${f.url}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Санитизация имени: убираем разделители путей и спецсимволы (S3/Strapi их отвергают, напр. "U16/U18").
  const cleanName = f.filename.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'file';
  const safe = cleanName.replace(/[^\w.\-]+/g, '_');
  const tmp = path.join(os.tmpdir(), `escdoc_${Date.now()}_${hash(f.url)}_${safe}`);
  fs.writeFileSync(tmp, buf);
  try {
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: {},
      files: { filepath: tmp, originalFilename: cleanName, mimetype: f.mime, size: buf.length },
    });
    return uploaded?.[0]?.id ?? null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export default factories.createCoreService(UID, ({ strapi }) => ({
  async syncOfficialDocs(payload: { docs?: InDoc[]; dryRun?: boolean } = {}) {
    // Инвентарь берём из тела запроса либо из зашитого файла (зеркало офиц. сайта).
    const docs: InDoc[] = payload?.docs?.length ? payload.docs : ((bundledInventory as any).docs as InDoc[]);
    const dryRun = !!payload?.dryRun;
    const keep = new Set<string>();
    let created = 0, updated = 0, uploaded = 0, reused = 0, deleted = 0;
    const errors: string[] = [];

    for (const d of docs) {
      if (!d.externalId || !d.files?.length) continue;
      keep.add(d.externalId);
      if (dryRun) continue;

      // существующий документ (по externalId) с уже загруженными файлами
      const existing = await strapi.db
        .query(UID)
        .findOne({ where: { externalId: d.externalId }, populate: { attachments: { populate: ['file'] } } });

      const attachments: any[] = [];
      for (const f of d.files) {
        // переиспользуем медиа, если у существующего документа уже есть вложение с тем же ярлыком+размером
        const prev = existing?.attachments?.find((a: any) => a.name === f.label && a.fileSize === f.size && a.file?.id);
        let fileId: number | null = prev?.file?.id ?? null;
        if (fileId) {
          reused++;
        } else {
          try {
            fileId = await uploadFromUrl(strapi, f);
            if (fileId) uploaded++;
          } catch (e) {
            errors.push(`${d.title} / ${f.label}: ${(e as Error).message}`);
          }
        }
        if (fileId) {
          attachments.push({
            name: f.label,
            fileSize: f.size,
            date: d.date,
            file: fileId,
            downloadCount: existing?.attachments?.find((a: any) => a.name === f.label)?.downloadCount || 0,
          });
        }
      }
      if (!attachments.length) {
        errors.push(`${d.title}: no files uploaded, skipped`);
        continue;
      }

      const data: any = {
        externalId: d.externalId,
        title: d.title,
        slug: `${kebab(d.title)}-${hash(d.externalId)}`,
        theme: d.theme,
        date: d.date,
        description: d.description,
        fileSize: d.fileSize,
        file: attachments[0].file,
        attachments,
        eventSlug: null,
      };

      if (existing) {
        await strapi.documents(UID).update({ documentId: existing.documentId, data, status: 'published' });
        updated++;
      } else {
        await strapi.documents(UID).create({ data, status: 'published' });
        created++;
      }
    }

    // Удаляем библиотечные документы (eventSlug пустой), которых нет в инвентаре — зеркало.
    const lib = await strapi.db
      .query(UID)
      .findMany({ where: { eventSlug: { $null: true } }, select: ['id', 'documentId', 'externalId'] });
    const stale = lib.filter((d: any) => !d.externalId || !keep.has(d.externalId));
    // Предохранитель: не удаляем старое, если синхронизация в основном провалилась
    // (иначе можно снести библиотеку, не создав замену).
    const synced = created + updated;
    const safeToDelete = synced >= Math.floor(docs.length * 0.9);
    if (!dryRun && !safeToDelete) {
      strapi.log.warn(`[docs] skipping deletion: only ${synced}/${docs.length} synced (need >=90%)`);
    }
    if (!dryRun && safeToDelete) {
      for (const s of stale) {
        try {
          await strapi.documents(UID).delete({ documentId: s.documentId });
          deleted++;
        } catch (e) {
          errors.push(`delete ${s.documentId}: ${(e as Error).message}`);
        }
      }
    }

    const summary = { inventory: docs.length, created, updated, uploaded, reused, deleted: dryRun ? stale.length : deleted, staleFound: stale.length, safeToDelete, errors: errors.length };
    strapi.log.info(`[docs] official mirror: ${JSON.stringify(summary)}`);
    if (errors.length) strapi.log.warn(`[docs] errors: ${errors.slice(0, 15).join(' | ')}`);
    return { ...summary, errorList: errors.slice(0, 40) };
  },
}));
