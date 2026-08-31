/**
 * category service
 *
 * syncFromThemes: создаёт категории из значений doc.theme и привязывает документы
 * к соответствующей категории (по совпадению названия). Идемпотентно — можно
 * запускать повторно. Работает с published-версиями (их читает фронт).
 */
import { factories } from '@strapi/strapi';

// as any: свежий content-type ещё не в сгенерированных типах — строгая проверка UID упала бы на strapi build.
const UID_CAT = 'api::category.category' as any;
const UID_DOC = 'api::doc.doc' as any;

// Порядок категорий — как в исходном enum темы документа
const ORDER = [
  'Official Documents', 'Assemblies', 'Sustainability', 'Courses', 'PRESS RELEASES',
  'Records', 'Ranking', 'Competitions', 'European Championships', 'European Champions League',
  'European Youth League', 'European Cup 25m', 'European Cup 300m', 'ESC Air Cup',
  'European Games', 'European Youth Olympic Festival', 'Olympic Games',
];

export default factories.createCoreService(UID_CAT, ({ strapi }) => ({
  async syncFromThemes() {
    // published-документы (их читает фронт), тянем тему + уже привязанную категорию
    const docs = await strapi.documents(UID_DOC).findMany({
      status: 'published',
      fields: ['theme'],
      populate: { category: true },
      limit: 2000,
    } as any);

    const themes = Array.from(new Set(docs.map((d: any) => d.theme).filter(Boolean)));

    // upsert категорий по имени
    const nameToId = new Map<string, number>();
    let createdCats = 0;
    for (const name of themes) {
      let cat = await strapi.db.query(UID_CAT).findOne({ where: { name } });
      if (!cat) {
        const order = ORDER.indexOf(name as string);
        cat = await strapi.documents(UID_CAT).create({
          data: { name, order: order >= 0 ? order : 999 } as any,
        });
        createdCats++;
      }
      nameToId.set(name as string, cat.id);
    }

    // привязать документы без категории
    let linked = 0;
    const errors: string[] = [];
    for (const d of docs as any[]) {
      if (d.category) continue;
      const catId = d.theme ? nameToId.get(d.theme) : null;
      if (!catId) continue;
      try {
        await strapi.documents(UID_DOC).update({
          documentId: d.documentId,
          data: { category: catId } as any,
          status: 'published',
        });
        linked++;
      } catch (e) {
        errors.push(`${d.documentId}: ${(e as Error).message}`);
      }
    }

    return { themes: themes.length, createdCats, linked, totalDocs: docs.length, errors: errors.slice(0, 10) };
  },
}));
