// Держим photoCount равным числу файлов в `images`: списку альбомов тогда не нужно
// populate по images (сотни строк на альбом), достаточно одного числа.
//
// Только через query engine (strapi.db.query): он работает в транзакции текущего запроса,
// поэтому видит только что обновлённые связи и не блокируется на строке альбома.
// Прямой knex (strapi.db.connection) здесь нельзя — он вне транзакции, а
// strapi.db.getConnection() возвращает builder withSchema, а не вызываемый knex.
const UID = 'api::photo.photo';

async function syncPhotoCount(id: number) {
  try {
    const row: any = await strapi.db.query(UID).findOne({ where: { id }, populate: { images: { select: ['id'] } } });
    if (!row) return;
    const count = Array.isArray(row.images) ? row.images.length : 0;
    if (row.photoCount === count) return;
    await strapi.db.query(UID).update({ where: { id }, data: { photoCount: count } });
  } catch (e) {
    // Счётчик — вспомогательный: его сбой не должен ломать сохранение альбома.
    strapi.log.error(`[photo] photoCount sync failed for #${id}: ${(e as Error).message}`);
  }
}

// Наше собственное update({ photoCount }) тоже проходит через afterUpdate — его пропускаем.
const isOwnWrite = (event: any) => {
  const keys = Object.keys(event?.params?.data || {});
  return keys.length === 1 && keys[0] === 'photoCount';
};

export default {
  async afterCreate(event: any) {
    if (event.result?.id) await syncPhotoCount(event.result.id);
  },
  async afterUpdate(event: any) {
    if (event.result?.id && !isOwnWrite(event)) await syncPhotoCount(event.result.id);
  },
};
