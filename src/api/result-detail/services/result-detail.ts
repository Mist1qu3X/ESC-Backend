/**
 * result-detail service
 *
 * Синхронизация результатов из SIUS Shooting Sports Cloud (публичный API, без токена):
 *   competition -> events -> subevents -> totalresults(+series) -> Result Detail
 * Берём европейские соревнования, привязываем к нашим Event по названию+датам,
 * upsert по externalId. Вызывается вручную (route) и по cron (config/server.ts).
 */
import { factories } from '@strapi/strapi';

const SIUS = 'https://shootingsportscloud.com:8594';
const enc = encodeURIComponent;

async function sget(path: string): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(SIUS + path, { signal: c.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function normDiscipline(name = ''): string {
  const n = name.toUpperCase();
  if (/RUNNING TARGET|MOVING/.test(n)) return 'MOVING TARGET';
  if (/SKEET|TRAP|SHOTGUN/.test(n)) return 'SHOTGUN';
  if (/AIR PISTOL/.test(n)) return '10M AIR PISTOL';
  if (/AIR RIFLE/.test(n)) return '10M AIR RIFLE';
  if (/25M|RAPID FIRE/.test(n)) return '25M PISTOL';
  if (/50M|300M|RIFLE 3|3X40|3X20|3 POSITION/.test(n)) return '50M RIFLE';
  if (/PISTOL/.test(n)) return '25M PISTOL';
  if (/RIFLE/.test(n)) return '50M RIFLE';
  return name;
}
function normCategory(name = ''): 'ALL' | 'MEN' | 'WOMEN' {
  const n = name.toUpperCase();
  if (/WOMEN|LADIES/.test(n)) return 'WOMEN';
  if (/\bMEN\b/.test(n)) return 'MEN';
  return 'ALL';
}
const toInt = (s: any): number | null => {
  const m = String(s ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
};
const normName = (s = ''): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Подбор нашего Event по названию + дате (окно 45 дней). null если нет уверенного совпадения.
function matchEvent(events: any[], compName: string, compDate: string): any | null {
  const cn = normName(compName);
  const stop = new Set(['european', 'championship', 'championships', 'cup', 'esc', 'final', 'the', 'and', 'for']);
  const tokens = cn.split(' ').filter((w) => w.length > 2 && !stop.has(w) && !/^\d{4}$/.test(w));
  const cTime = compDate ? new Date(compDate).getTime() : null;
  let best: any = null;
  let bestScore = 0;
  for (const e of events) {
    const en = normName(e.name || '');
    let score = tokens.filter((tk) => en.includes(tk)).length;
    if (score === 0) continue;
    if (cTime && e.date) {
      const diff = Math.abs(new Date(e.date).getTime() - cTime) / 86400000;
      if (diff > 45) continue;
      score += 2 - Math.min(2, diff / 30);
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return bestScore >= 2 ? best : null;
}

export default factories.createCoreService('api::result-detail.result-detail', ({ strapi }) => ({
  async syncFromSius(opts: { nameFilter?: string; maxCompetitions?: number } = {}) {
    const nameFilter = opts.nameFilter ?? '';
    const maxComps = opts.maxCompetitions ?? 200;

    const events: any[] = await strapi.db
      .query('api::event.event')
      .findMany({ select: ['id', 'name', 'slug', 'date'], limit: 2000 });

    const comps =
      (await sget(`/api/v1/pub/competitions?IsPublic=true&Page=1&PageSize=${maxComps}&Name=${enc(nameFilter)}`))?.data || [];

    let matched = 0;
    let rows = 0;
    let created = 0;
    let updated = 0;
    const unmatched: string[] = [];

    for (const c of comps) {
      const cid = c.RunningId;
      const ev = matchEvent(events, c.Name || '', c.StartDate || '');
      if (!ev?.slug) {
        unmatched.push(`${(c.StartDate || '').slice(0, 10)} ${c.Name}`);
        continue;
      }
      matched++;
      const eventSlug = ev.slug;

      const evs = (await sget(`/api/v1/pub/competitions/events?CompetitionId=${enc(cid)}`)) || [];
      for (const e of evs) {
        const eid = e.RunningId;
        const evName = e.CompetitionEventType?.Name || '';
        const discipline = normDiscipline(evName);
        const category = normCategory(evName);
        const subs = await sget(`/api/v1/pub/competitions/${enc(cid)}/events/${enc(eid)}/subevents`);
        if (!Array.isArray(subs)) continue;
        const se = subs.find((s: any) => /final/i.test(s.Name || '')) || subs[subs.length - 1];
        if (!se) continue;
        const sid = se.RunningId;
        const groups = se.ShooterGroups?.length ? se.ShooterGroups : [''];

        for (const g of groups) {
          let q = `runningCompetitionId=${enc(cid)}&runningCompetitionEventId=${enc(eid)}&subEventId=${enc(sid)}&teamKind=Individual`;
          if (g) q += `&shooterGroup=${enc(g)}`;
          const tr = await sget('/api/v1/pub/totalresults?' + q);
          const arr = tr?.[0]?.['TotalResults-Individual'];
          if (!arr?.length) continue;
          const sr = await sget('/api/v1/pub/series?' + q);
          const sArr = sr?.[0]?.['Series-Individual'] || [];
          const shotsByName: Record<string, string[]> = {};
          for (const x of sArr) {
            const series = (x.AthletesSeries?.[0]?.Series || []).flat();
            shotsByName[x.DisplayName] = series.map((v: any) => v.Value).filter(Boolean);
          }

          for (const r of arr) {
            rows++;
            const externalId = `sius:${cid}:${eid}:${sid}:${g}:${r.AthletesResults?.[0]?.AthleteIdentifier?.Identifier || r.DisplayName}`;
            const data: any = {
              externalId,
              eventSlug,
              position: toInt(r.Rank?.DisplayText) ?? 0,
              athleteName: r.DisplayName || '—',
              federationCode: (r.Nation || '').replace(/\s+\d+$/, '') || '—',
              total: String(r.Result?.Value ?? ''),
              discipline,
              category,
              shots: shotsByName[r.DisplayName] || [],
            };
            try {
              const existing = await strapi.db
                .query('api::result-detail.result-detail')
                .findOne({ where: { externalId } });
              if (existing) {
                await strapi.db
                  .query('api::result-detail.result-detail')
                  .update({ where: { id: existing.id }, data });
                updated++;
              } else {
                await strapi.db
                  .query('api::result-detail.result-detail')
                  .create({ data });
                created++;
              }
            } catch (e) {
              strapi.log.error(`[sius] upsert failed ${externalId}: ${(e as Error).message}`);
            }
          }
        }
      }
    }

    const summary = { competitions: comps.length, matched, unmatched: unmatched.length, rows, created, updated };
    strapi.log.info(`[sius] results sync: ${JSON.stringify(summary)}`);
    if (unmatched.length) strapi.log.info(`[sius] unmatched competitions: ${unmatched.slice(0, 20).join(' | ')}`);
    return { ...summary, unmatchedList: unmatched };
  },
}));
