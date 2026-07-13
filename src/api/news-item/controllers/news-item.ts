/**
 * news-item controller
 *
 * Возвращает "голый" массив (контракт фронтенда), но через штатный core-контроллер,
 * поэтому вывод санитайзится (не утекают password/resetPasswordToken админа из createdBy/updatedBy)
 * и соблюдаются пагинация и лимиты из config/api.ts. Раньше find/findOne отдавали сырой
 * результат entityService с ctx.query, что приводило к утечке хешей паролей и выдаче всех
 * записей независимо от пагинации.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::news-item.news-item', () => ({
  async find(ctx) {
    const { data } = await super.find(ctx);
    return data;
  },
  async findOne(ctx) {
    const { data } = await super.findOne(ctx);
    return data;
  },
}));
