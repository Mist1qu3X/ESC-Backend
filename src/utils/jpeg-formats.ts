import type { Core } from '@strapi/strapi';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

// Фото, залитые как PNG, получают PNG-превью по 1–1.7 МБ — в 10 раз тяжелее нужного.
// После создания/замены файла перекодируем его форматы в JPEG (q80), если картинка непрозрачная.
// Оригинал не трогаем; логотипы и флаги с прозрачностью остаются PNG.
const BREAKPOINTS: Record<string, number> = { xlarge: 1920, large: 1000, medium: 750, small: 500 };
const THUMB = { width: 245, height: 156 };
const kb = (bytes: number) => Math.round((bytes / 1000) * 100) / 100;
// Старые PNG-превью убираем с задержкой: ответы API с их адресами ещё могут лежать в кэше nginx.
const DELETE_OLD_AFTER_MS = 5 * 60 * 1000;

export async function convertPngFormatsToJpeg(strapi: Core.Strapi, file: any) {
  if (!file || file.mime !== 'image/png' || !file.formats || !file.hash) return;
  const entries = Object.entries(file.formats as Record<string, any>).filter(([, f]) => f?.ext === '.png');
  if (!entries.length) return;

  const dir = path.join(strapi.dirs.static.public, 'uploads');
  const src = path.join(dir, `${file.hash}${file.ext}`);
  if (!fs.existsSync(src)) return;
  const stats = await sharp(src).stats();
  if (!stats.isOpaque) return;

  const formats: Record<string, any> = { ...file.formats };
  const old: string[] = [];
  for (const [key, entry] of entries) {
    const box = key === 'thumbnail' ? THUMB : { width: BREAKPOINTS[key], height: BREAKPOINTS[key] };
    if (!box.width) continue;
    const hash = `${key}_${file.hash}`;
    const info = await sharp(src).resize({ ...box, fit: 'inside' }).jpeg({ quality: 80 }).toFile(path.join(dir, `${hash}.jpg`));
    old.push(path.join(dir, `${hash}.png`));
    formats[key] = {
      ...entry,
      name: String(entry.name || `${key}_${file.name}`).replace(/\.png$/i, '.jpg'),
      hash,
      ext: '.jpg',
      mime: 'image/jpeg',
      width: info.width,
      height: info.height,
      size: kb(info.size),
      sizeInBytes: info.size,
      url: `/uploads/${hash}.jpg`,
    };
  }

  // Фото ≤1920px не получает xlarge (Strapi делает форматы только меньше оригинала), и десктопный
  // герой брал бы PNG-оригинал в ~800 КБ. Делаем xlarge-JPEG в размере оригинала.
  const { width = 0, height = 0 } = file;
  if (!formats.xlarge && width <= BREAKPOINTS.xlarge && height <= BREAKPOINTS.xlarge && (width > BREAKPOINTS.large || height > BREAKPOINTS.large)) {
    const hash = `xlarge_${file.hash}`;
    const info = await sharp(src).jpeg({ quality: 80 }).toFile(path.join(dir, `${hash}.jpg`));
    formats.xlarge = {
      name: `xlarge_${String(file.name).replace(/\.png$/i, '.jpg')}`, hash, ext: '.jpg', mime: 'image/jpeg', path: null,
      width: info.width, height: info.height, size: kb(info.size), sizeInBytes: info.size, url: `/uploads/${hash}.jpg`,
    };
  }

  // Напрямую в таблицу, минуя query engine — иначе снова сработает afterUpdate.
  await strapi.db.connection.raw('update files set formats = ?::jsonb where id = ?', [JSON.stringify(formats), file.id]);
  setTimeout(() => { for (const p of old) fs.rm(p, { force: true }, () => {}); }, DELETE_OLD_AFTER_MS);
  strapi.log.info(`[upload] PNG formats re-encoded as JPEG for file #${file.id} (${file.name})`);
}

export function subscribeJpegFormats(strapi: Core.Strapi) {
  const run = (event: any) => {
    // Не ждём: загрузка в админке не должна зависеть от перекодирования.
    convertPngFormatsToJpeg(strapi, event?.result).catch((e: Error) =>
      strapi.log.error(`[upload] PNG→JPEG formats failed for file #${event?.result?.id}: ${e.message}`)
    );
  };
  strapi.db.lifecycles.subscribe({
    models: ['plugin::upload.file'],
    afterCreate: run,
    afterUpdate: run,
  });
}
