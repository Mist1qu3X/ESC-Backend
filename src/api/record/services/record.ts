/**
 * record service
 */

import { factories } from '@strapi/strapi';
import bundledRecords from '../records.json';

const UID = 'api::record.record';

export default factories.createCoreService(UID, ({ strapi }) => ({
  // Полный перенос официальных европейских рекордов ESC из bundled records.json
  // (распарсены 1:1 из PDF на esc-shooting.org/documents/records). Чистит коллекцию
  // и создаёт все записи заново — идемпотентно и перезапускаемо. Тело: { dryRun? }.
  async syncOfficial(opts: { dryRun?: boolean } = {}) {
    const rows = (bundledRecords as any[]) || [];
    if (!rows.length) return { error: 'no bundled records', created: 0 };
    let purged = 0, created = 0, errors = 0;
    if (!opts.dryRun) {
      const del = await strapi.db.query(UID).deleteMany({ where: { id: { $notNull: true } } });
      purged = del?.count ?? 0;
      for (const r of rows) {
        try {
          await strapi.documents(UID).create({
            data: {
              type: String(r.type || '').trim(),
              athleteName: String(r.athleteName || '').trim(),
              federationCode: String(r.federationCode || '').trim(),
              record: String(r.record || '').trim(),
              location: String(r.location || '').trim(),
              date: r.date || null,
              discipline: String(r.discipline || '').trim(),
              category: String(r.category || 'ALL').trim(),
            } as any,
            status: 'published',
          });
          created++;
        } catch (e) {
          errors++;
        }
      }
    }
    const summary = { inBundle: rows.length, purged, created, errors };
    strapi.log.info(`[records] sync-official: ${JSON.stringify(summary)}`);
    return summary;
  },
}));
