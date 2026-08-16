/**
 * ranking-detail service
 */

import { factories } from '@strapi/strapi';
import bundledRankings from '../rankings.json';

const UID = 'api::ranking-detail.ranking-detail';

export default factories.createCoreService(UID, ({ strapi }) => ({
  // Полный перенос официального европейского рейтинга ESC из bundled rankings.json
  // (распарсен 1:1 из 12 PDF на esc-shooting.org/documents/ranking — по дисциплине/полу,
  // формат Rank / Name / Nation / Year of birth). Чистит коллекцию и создаёт все записи
  // заново — идемпотентно и перезапускаемо. Тело: { dryRun? }.
  async syncOfficial(opts: { dryRun?: boolean } = {}) {
    const rows = (bundledRankings as any[]) || [];
    if (!rows.length) return { error: 'no bundled rankings', created: 0 };
    let purged = 0, created = 0, errors = 0;
    if (!opts.dryRun) {
      const del = await strapi.db.query(UID).deleteMany({ where: { id: { $notNull: true } } });
      purged = del?.count ?? 0;
      for (const r of rows) {
        try {
          await strapi.documents(UID).create({
            data: {
              position: Number(r.position) || 0,
              athleteName: String(r.athleteName || '').trim(),
              country: String(r.country || '').trim(),
              yearOfBirth: r.yearOfBirth != null ? Number(r.yearOfBirth) : null,
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
    strapi.log.info(`[rankings] sync-official: ${JSON.stringify(summary)}`);
    return summary;
  },
}));
