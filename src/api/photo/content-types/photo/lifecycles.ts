// Держим photoCount равным числу файлов в `images`: списку альбомов тогда не нужно
// populate по images (сотни строк на альбом), достаточно одного числа.
const UID = 'api::photo.photo';

async function syncPhotoCount(id: number) {
  // getConnection() учитывает транзакцию текущего запроса — иначе свежие связи ещё не видны.
  const knex = strapi.db.getConnection();
  const row = await knex('files_related_mph')
    .where({ related_id: id, related_type: UID, field: 'images' })
    .count<{ count: string | number }[]>({ count: '*' })
    .first();
  const count = Number(row?.count ?? 0);
  // Прямой update через knex, а не через query engine — чтобы не зациклить afterUpdate.
  await knex('photos').where({ id }).update({ photo_count: count });
}

export default {
  async afterCreate(event: { result?: { id?: number } }) {
    if (event.result?.id) await syncPhotoCount(event.result.id);
  },
  async afterUpdate(event: { result?: { id?: number } }) {
    if (event.result?.id) await syncPhotoCount(event.result.id);
  },
};
