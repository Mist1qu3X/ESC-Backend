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

// Возвращает каноническую дисциплину ИЛИ null, если по названию не определить
// (тогда вызывающий пробует название соревнования / под-события как контекст).
function normDiscipline(name = ''): string | null {
  const n = name.toUpperCase();
  if (/RUNNING TARGET|MOVING/.test(n)) return 'MOVING TARGET';
  if (/SKEET|TRAP|SHOTGUN/.test(n)) return 'SHOTGUN';
  if (/AIR PISTOL/.test(n)) return '10M AIR PISTOL';
  if (/AIR RIFLE/.test(n)) return '10M AIR RIFLE';
  if (/50\s?M.*PISTOL|PISTOL.*50\s?M/.test(n)) return '50M PISTOL';
  if (/25M|RAPID FIRE|STANDARD PISTOL|CENTRE FIRE|CENTER FIRE|SPORT PISTOL/.test(n)) return '25M PISTOL';
  if (/300\s?M|300\s?METRE|300\s?METER|\bBRANCO\b/.test(n)) return '300M RIFLE';
  if (/50M|RIFLE 3|3X40|3X20|3 POSITION/.test(n)) return '50M RIFLE';
  if (/PISTOL/.test(n)) return '25M PISTOL';
  if (/RIFLE/.test(n)) return '50M RIFLE';
  return null;
}
// Срезаем повторяющийся префикс названия соревнования из ярлыка дисциплины
// ("EUROPEAN CHAMPIONS LEAGUE SKEET SOLO" -> "SKEET SOLO").
function stripCompPrefix(s = ''): string {
  const out = s
    .replace(/^\s*european\s+champions?\s+league\s+/i, '')
    .replace(/^\s*european\s+(championships?|cup|games|youth\s+league)\s+/i, '')
    .trim();
  return out || s.trim();
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

// Только явно европейские ESC-соревнования (SIUS содержит и мировые World Cup / нац. первенства — их не берём).
const EU_RE = /european|champions league|european cup|european games|youth league|eyof|\besc\b/i;
const MATCH_STOP = new Set(['the', 'and', 'for', 'of', 'final', 'round', 'stage', 'part']);

// Строгий подбор нашего Event: соревнование должно быть европейским, даты в пределах 14 дней
// (то же событие), и минимум 3 значимых слова названия должны совпасть. Иначе null — без совпадения.
function matchEvent(events: any[], compName: string, compDate: string): any | null {
  if (!EU_RE.test(compName)) return null;
  const cn = normName(compName);
  const tokens = cn.split(' ').filter((w) => w.length > 2 && !MATCH_STOP.has(w) && !/^\d{4}$/.test(w));
  const cTime = compDate ? new Date(compDate).getTime() : null;
  if (!cTime) return null;
  let best: any = null;
  let bestScore = 0;
  for (const e of events) {
    if (!e.date) continue;
    const diff = Math.abs(new Date(e.date).getTime() - cTime) / 86400000;
    if (diff > 14) continue;
    const en = normName(e.name || '');
    const hit = tokens.filter((tk) => en.includes(tk)).length;
    // >=3 значимых слова в окне 14 дней, ИЛИ >=2 при почти точной дате (<=3 дня) —
    // ловит короткие названия вроде "European Games" и "European Championship" (Châteauroux).
    if (!(hit >= 3 || (hit >= 2 && diff <= 3))) continue;
    const score = hit + (2 - Math.min(2, diff / 7));
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

export default factories.createCoreService('api::result-detail.result-detail', ({ strapi }) => ({
  async syncFromSius(opts: { nameFilter?: string; maxCompetitions?: number; purge?: boolean } = {}) {
    const nameFilter = opts.nameFilter ?? '';
    const maxComps = opts.maxCompetitions ?? 200;

    let purged = 0;

    const events: any[] = await strapi.db
      .query('api::event.event')
      .findMany({ select: ['id', 'name', 'slug', 'date'], limit: 2000 });

    const comps =
      (await sget(`/api/v1/pub/competitions?IsPublic=true&Page=1&PageSize=${maxComps}&Name=${enc(nameFilter)}`))?.data || [];

    // Полная переиндексация — ТОЛЬКО если SIUS реально ответил (иначе при недоступности
    // сотрём всё и не зальём). Удаляем старые sius-строки перед чистым импортом.
    if (opts.purge && comps.length > 0) {
      const del = await strapi.db
        .query('api::result-detail.result-detail')
        .deleteMany({ where: { externalId: { $startsWith: 'sius:' } } });
      purged = del?.count ?? 0;
      strapi.log.info(`[sius] purged ${purged} existing rows before re-import`);
    }

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

      // Официальные PDF-ранклисты по стадиям: событие(runningId/eventCode) → {стадия → cloudStorageKey}.
      // Приоритет статусу "Approved". Ссылка на PDF: `${SIUS}/api/v1/doc/${key}` (отдаёт application/pdf).
      const ranklist = await sget(`/api/v1/doc/competitions/${enc(cid)}/ranklist`);
      const pdfByEvent: Record<string, Record<string, string>> = {};
      if (Array.isArray(ranklist)) {
        for (const rev of ranklist) {
          const m: Record<string, string> = {};
          for (const se of rev.subEvents || []) {
            const nm = (se.name || '').toLowerCase().trim();
            if (!nm || !se.cloudStorageKey) continue;
            if (!(nm in m) || /approved/i.test(se.status || '')) m[nm] = se.cloudStorageKey;
          }
          if (rev.runningId) pdfByEvent[rev.runningId] = m;
          if (rev.eventCode) pdfByEvent[rev.eventCode] = m;
        }
      }

      const evs = (await sget(`/api/v1/pub/competitions/events?CompetitionId=${enc(cid)}`)) || [];
      for (const e of evs) {
        const eid = e.RunningId;
        const evName = e.CompetitionEventType?.Name || '';
        // Пропускаем стартлисты — это не результаты (в них дубли и нет мест).
        if (/start.?list/i.test(evName)) continue;
        const discEv = normDiscipline(evName);
        const category = normCategory(evName);
        const subs = await sget(`/api/v1/pub/competitions/${enc(cid)}/events/${enc(eid)}/subevents`);
        if (!Array.isArray(subs)) continue;
        // Пропускаем стартлисты, дуэли (2 чел, шум командного формата), overview-своды
        // и ТРЕНИРОВКИ (PreEventTraining / Unofficial Training) — это не результаты.
        const real = subs.filter((s: any) => !/start.?list|duel|overview|training|pre.?event/i.test(s.Name || ''));
        // Импортируем ВСЕ стадии (Qualification/Final/Semifinal/Medal Match), а не одну —
        // иначе теряется полный список участников. subDiscipline различает стадии.
        for (const se of real) {
        const sid = se.RunningId;
        const seName = (se.Name || '').replace(/\s+/g, ' ').trim();
        // Дисциплина: имя события → имя под-события → название соревнования (контекст) → OTHER.
        // Ловит и "European Cup BRANCO Final" (300m по comp), и пустые evName (по seName).
        const discipline = discEv || normDiscipline(seName) || normDiscipline(c.Name || '') || 'OTHER';
        const baseDisc = stripCompPrefix((evName || '').replace(/\s+/g, ' ').trim());
        // Событие-склейка нескольких этапов (в названии "&"/"and", напр. Lapua Sweden & Eskilstuna):
        // два соревнования SIUS матчатся в одно наше событие → различаем этап по "хвосту" его названия,
        // иначе одинаковые дисциплины двух этапов пулятся (дубли атлетов/мест). Обычных событий не трогает.
        const legTag =
          / & | and /i.test(ev.name || '')
            ? (c.Name || '').replace(/^.*european\s+cup\s*/i, '').replace(/^.*european\s+championship[s]?\s*/i, '').trim()
            : '';
        const subDisc =
          ((real.length > 1 && seName ? `${baseDisc} — ${seName}` : baseDisc) || discipline) +
          (legTag ? ` · ${legTag}` : '');
        // Пол может быть в имени под-события (напр. "Semifinal Women 1"), а не события.
        const cat = category !== 'ALL' ? category : normCategory(seName);
        // Командные события (Team=true) грузим как команды (TeamOfIndividuals): строка = команда
        // (страна), total = суммарный, участники → shotDetail. Иначе как индивидуалов.
        const isTeam = e.Team === true;
        const kind = isTeam ? 'TeamOfIndividuals' : 'Individual';
        const resKey = `TotalResults-${kind}`;
        const serKey = `Series-${kind}`;
        // Гостевые группы (вне зачёта, со своей нумерацией) пропускаем при наличии основных —
        // иначе гость с rank 1 и неполным результатом лезет в общий ранкинг (LÖFVANDER 173-6x).
        const allGroups = se.ShooterGroups?.length ? se.ShooterGroups : [''];
        const mainGroups = allGroups.filter((gr: string) => !/guest|g[aä]ste|hors/i.test(gr));
        const useGroups = mainGroups.length ? mainGroups : allGroups;
        // PDF-ранклист этой стадии (по имени под-события).
        const evPdf = pdfByEvent[eid] || pdfByEvent[e.CompetitionEventType?.EventCode || ''] || {};
        const pdfUrl = evPdf[seName.toLowerCase()] ? `${SIUS}/api/v1/doc/${evPdf[seName.toLowerCase()]}` : '';

        for (const g of useGroups) {
          let q = `runningCompetitionId=${enc(cid)}&runningCompetitionEventId=${enc(eid)}&subEventId=${enc(sid)}&teamKind=${kind}`;
          if (g) q += `&shooterGroup=${enc(g)}`;
          const tr = await sget('/api/v1/pub/totalresults?' + q);
          const arr = tr?.[0]?.[resKey];
          if (!arr?.length) continue;
          const sr = await sget('/api/v1/pub/series?' + q);
          const sArr = sr?.[0]?.[serKey] || [];
          const shotsByName: Record<string, string[]> = {};
          for (const x of sArr) {
            const series = (x.AthletesSeries?.[0]?.Series || []).flat();
            shotsByName[x.DisplayName] = series.map((v: any) => v.Value).filter(Boolean);
          }
          // По-выстрельно (10.8, 10.5… / hit-miss) по AthleteRunningId — только для индивидуалов.
          const shotDetailById: Record<string, string[]> = {};
          if (!isTeam) {
            const shd = await sget('/api/v1/pub/shots?' + q);
            for (const x of shd?.[0]?.['Shots-Individual'] || []) {
              shotDetailById[x.AthleteRunningId] = (x.ShotViewDatas || [])
                .map((s: any) => (s.Miss ? '0' : String(s.Scores?.[0] ?? '').trim()))
                .filter((v: string) => v !== '');
            }
          }

          for (const r of arr) {
            rows++;
            const athRid = r.AthletesResults?.[0]?.AthleteIdentifier?.RunningId;
            const externalId = `sius:${cid}:${eid}:${sid}:${g}:${r.AthletesResults?.[0]?.AthleteIdentifier?.Identifier || r.DisplayName}`;
            // SIUS Result.Value = итог + внутренние десятки одной строкой ("583-24x").
            const rawTotal = String(r.Result?.Value ?? '');
            // Нет итога → это не результат (пустые Qualification Shoot-Off — только места без очков,
            // а также DNS/DNF без результата). Порядок перестрелки уже отражён в основной квалификации.
            if (!rawTotal.trim()) continue;
            const im = rawTotal.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\s*x?$/i);
            const members = isTeam ? (r.AthletesResults || []).map((a: any) => a.DisplayName).filter(Boolean) : null;
            const data: any = {
              externalId,
              eventSlug,
              position: toInt(r.Rank?.DisplayText) ?? 0,
              athleteName: r.DisplayName || '—',
              federationCode: (r.Nation || '').replace(/\s+\d+$/, '') || (isTeam ? '' : '—'),
              total: im ? im[1] : rawTotal,
              inner10s: im ? im[2] : '',
              discipline,
              subDiscipline: subDisc,
              category: cat,
              isTeam,
              // Команда: в shots — состав (имена участников, небольшой массив, идёт в общий запрос).
              // Индивидуал: в shots — суммы серий, в shotDetail — по-выстрельно (тянется по клику).
              shots: isTeam ? members || [] : shotsByName[r.DisplayName] || [],
              shotDetail: isTeam ? [] : shotDetailById[athRid] || [],
              pdfUrl,
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
    }

    // Обновляем флаги hasResults на событиях (для ленивой загрузки страницы Results).
    let flags: any = null;
    try {
      flags = await strapi.service('api::event.event').refreshEventResultFlags();
    } catch (e) {
      strapi.log.error(`[sius] refreshEventResultFlags failed: ${(e as Error).message}`);
    }
    const summary = { competitions: comps.length, matched, unmatched: unmatched.length, rows, created, updated, purged, flags };
    strapi.log.info(`[sius] results sync: ${JSON.stringify(summary)}`);
    if (unmatched.length) strapi.log.info(`[sius] unmatched competitions: ${unmatched.slice(0, 20).join(' | ')}`);
    return { ...summary, unmatchedList: unmatched };
  },
}));
