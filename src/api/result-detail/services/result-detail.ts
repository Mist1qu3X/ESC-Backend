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
const RD = 'api::result-detail.result-detail';
const enc = encodeURIComponent;

// Гард от параллельных прогонов синка (один Node-процесс Strapi). Не даёт ночному полному
// синку и получасовому live-синку (или двум live подряд) пересекаться и плодить дубли.
let syncInProgress = false;

async function sget(path: string, timeoutMs = 15000): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
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

// Группы стрелков вне основного зачёта: гости, RPO (Ranking Points Only — у них «виртуальные»
// места, совпадающие с местами основного зачёта), OOC (out of competition). Берём их, только
// если других групп у стадии нет — иначе гость/RPO со своим местом лезет в общий ранкинг
// (LÖFVANDER 173-6x с rank 1).
const OFF_GROUP_RE = /guest|g[aä]ste|hors|\brpo\b|\booc\b|out.?of.?comp/i;

// Стадии события из /subevents. Сейчас SIUS отдаёт по строке на каждую пару (TeamKind,
// ShooterGroup) одной стадии — RunningId повторяется, а teamKind и shooterGroup стали
// ОБЯЗАТЕЛЬНЫМИ параметрами /totalresults, /series и /shots (без них — HTTP 400). В августе 2026
// была одна строка на стадию со списком ShooterGroups; после смены формата синк не импортировал
// ничего. Собираем строки обратно: стадия → { вид зачёта → группы }. Скрытые (Hidden) стадии —
// тренировки, перестрелки, отдельные смены квалификации — не берём.
type Stage = { sid: string; name: string; groups: Record<string, string[]> };
function collectStages(subs: any[]): Stage[] {
  const byId = new Map<string, Stage>();
  for (const s of subs) {
    if (!s?.RunningId || s.Hidden === true || !s.TeamKind || !s.ShooterGroup) continue;
    let st = byId.get(s.RunningId);
    if (!st) {
      st = { sid: s.RunningId, name: String(s.Name || '').replace(/\s+/g, ' ').trim(), groups: {} };
      byId.set(s.RunningId, st);
    }
    const gs = st.groups[s.TeamKind] || (st.groups[s.TeamKind] = []);
    if (!gs.includes(s.ShooterGroup)) gs.push(s.ShooterGroup);
  }
  return [...byId.values()];
}

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
  async syncFromSius(opts: { nameFilter?: string; maxCompetitions?: number; purge?: boolean; activeOnly?: boolean } = {}) {
    if (syncInProgress) {
      strapi.log.warn('[sius] sync already in progress — skipping this run');
      return { skipped: true };
    }
    syncInProgress = true;
    try {
    const nameFilter = opts.nameFilter ?? '';
    const maxComps = opts.maxCompetitions ?? 200;

    let purged = 0;

    const events: any[] = await strapi.db
      .query('api::event.event')
      .findMany({ select: ['id', 'name', 'slug', 'date'], limit: 2000 });

    const comps =
      (await sget(`/api/v1/pub/competitions?IsPublic=true&Page=1&PageSize=${maxComps}&Name=${enc(nameFilter)}`))?.data || [];

    // Режим «только активные» (частый live-поллинг): берём соревнования, которые идут сейчас
    // (началось и ещё не закончилось) + сутки после конца, чтобы поймать финальные результаты
    // до ночного синка. Без purge — только upsert.
    let compsToProcess = comps;
    if (opts.activeOnly) {
      const now = Date.now();
      const DAY = 86400000;
      compsToProcess = comps.filter((c: any) => {
        const s = c.StartDate ? new Date(c.StartDate).getTime() : NaN;
        const e = c.EndDate ? new Date(c.EndDate).getTime() : s;
        return !isNaN(s) && s <= now && (isNaN(e) ? s : e) + DAY >= now;
      });
      strapi.log.info(`[sius] live sync: ${compsToProcess.length} active competition(s) of ${comps.length}`);
    }

    // purge = зеркалирование: строки, которых SIUS больше не отдаёт, удаляем ПОСЛЕ импорта и только
    // у событий SIUS (cid:eid), прочитанных в этом прогоне целиком, без единой ошибки запроса/записи.
    // Раньше purge стирал все sius-строки ДО импорта, если ответил хотя бы список соревнований, —
    // и когда SIUS сменил формат API, импорт не дал ни строки, а страница Results осталась пустой
    // (у всех событий hasResults=false → только PDF). Теперь сбой SIUS оставляет прежние данные.
    const seen = new Set<string>();       // externalId, записанные в этом прогоне
    const cleanPrefixes: string[] = [];   // `sius:${cid}:${eid}:` событий, прочитанных без ошибок

    let matched = 0;
    let rows = 0;
    let created = 0;
    let updated = 0;
    const unmatched: string[] = [];

    for (const c of compsToProcess) {
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
        // Пропускаем стартлисты — это не результаты (в них дубли и нет мест).
        if (/start.?list/i.test(evName)) continue;
        const discEv = normDiscipline(evName);
        const category = normCategory(evName);
        const subs = await sget(`/api/v1/pub/competitions/${enc(cid)}/events/${enc(eid)}/subevents`);
        if (!Array.isArray(subs)) continue;
        // Событие прочитано целиком (все запросы к SIUS ответили, все строки записались) —
        // только тогда purge может удалить его устаревшие строки.
        let complete = true;
        // Пропускаем стартлисты, overview-своды и ТРЕНИРОВКИ (PreEventTraining / Unofficial Training).
        // Дуэли (2 чел, шум): скипаем только ИНДИВИДУАЛЬНЫЕ ("SF1 - Duel 01"). КОМАНДНЫЕ дуэли
        // ("SF1 - Mixed Team Duel") НЕ трогаем — там реальный командный результат (напр. Skeet Team на
        // Champions League), у него Individual пуст, а TeamOfIndividuals содержит команды.
        const real = collectStages(subs).filter((s) => {
          const n = s.name;
          if (/start.?list|overview|training|pre.?event/i.test(n)) return false;
          if (/\bduel\b/i.test(n) && !/team/i.test(n)) return false;
          return true;
        });
        // Виды зачёта берём из самих стадий (SIUS перечисляет, какие есть). Выделенное командное
        // событие ("… Team" в имени, Team=true) → только команды (как 300m Team), его Individual —
        // это те же стрелки внутри команд. Командный зачёт обычного события (TeamOfIndividuals)
        // берём независимо от флага e.Team: SIUS ставит Team=false даже там, где нация-команда реально
        // есть в официальном result-book — напр. «25m Pistol Women» даёт «25m Pistol Women Team» FRA 1748.
        // Суффикс " Team" не добавляем, если "team" уже есть в имени события ("… DUET MIXED TEAM …").
        const nameHasTeam = /\bteam\b/i.test(evName);
        const teamOnly = nameHasTeam && e.Team === true;
        const teamSuffix = nameHasTeam ? '' : ' Team';
        // Импортируем ВСЕ стадии (Qualification/Final/Semifinal/Medal Match), а не одну —
        // иначе теряется полный список участников. subDiscipline различает стадии.
        for (const se of real) {
        const sid = se.sid;
        const seName = se.name;
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
        // Пол может быть в имени под-события (напр. "Semifinal Women 1"), а не события.
        const cat = category !== 'ALL' ? category : normCategory(seName);
        // "Individual" как имя под-события — это заглушка главного зачёта, не настоящая стадия
        // (иначе у команд выходит "… Team — Individual"). Не добавляем её в название.
        const stagePart = real.length > 1 && seName && !/^individual$/i.test(seName) ? ` — ${seName}` : '';
        const legPart = legTag ? ` · ${legTag}` : '';

        for (const [kind, groups] of Object.entries(se.groups)) {
        const isTeam = kind !== 'Individual';
        if (teamOnly && !isTeam) continue;
        const resKey = `TotalResults-${kind}`;
        const serKey = `Series-${kind}`;
        // Командный зачёт у "Individual"-события: убираем "Individual" и добавляем "Team",
        // иначе получается противоречивое "Skeet Individual U18 Women Team". Выделенные
        // командные события (суффикс пуст, имя уже с TEAM) и индивидуалов не трогаем.
        const suffix = isTeam ? teamSuffix : '';
        const viewBase = suffix
          ? baseDisc.replace(/\bindividual\b/gi, '').replace(/\s{2,}/g, ' ').trim() + suffix
          : baseDisc;
        const subDisc = ((viewBase + stagePart) || discipline) + legPart;
        // Группы вне зачёта (гости, RPO, OOC) пропускаем при наличии основных; основную (Regulars) — первой.
        const mainGroups = groups.filter((gr) => !OFF_GROUP_RE.test(gr));
        const useGroups = (mainGroups.length ? mainGroups : groups)
          .slice()
          .sort((a, b) => Number(b === 'Regulars') - Number(a === 'Regulars'));
        // Один стрелок/команда — одна строка на стадию: у юниорских событий SIUS отдаёт один и тот же
        // список и в группе Junior, и в Regulars.
        const taken = new Set<string>();

        for (const g of useGroups) {
          const q = `runningCompetitionId=${enc(cid)}&runningCompetitionEventId=${enc(eid)}&subEventId=${enc(sid)}&teamKind=${enc(kind)}&shooterGroup=${enc(g)}`;
          const tr = await sget('/api/v1/pub/totalresults?' + q);
          if (!Array.isArray(tr)) {
            complete = false;
            continue;
          }
          const arr = tr[0]?.[resKey];
          if (!arr?.length) continue;
          // Суммы серий и по-выстрельно (10.8, 10.5… / hit-miss) — только для индивидуалов
          // (у команды в shots пишется состав). /shots тяжёлый: на квалификацию из ~80 человек
          // ~3 МБ без gzip, ~30 с — поэтому свой таймаут, иначе по-выстрельно у больших стадий теряется.
          const shotsByName: Record<string, string[]> = {};
          const shotDetailById: Record<string, string[]> = {};
          // Не ответили /series или /shots — не затираем уже сохранённые серии/выстрелы пустыми.
          let seriesOk = true;
          let shotsOk = true;
          if (!isTeam) {
            const sr = await sget('/api/v1/pub/series?' + q);
            seriesOk = Array.isArray(sr);
            for (const x of sr?.[0]?.[serKey] || []) {
              const series = (x.AthletesSeries?.[0]?.Series || []).flat();
              shotsByName[x.DisplayName] = series.map((v: any) => v.Value).filter(Boolean);
            }
            const shd = await sget('/api/v1/pub/shots?' + q, 90000);
            shotsOk = Array.isArray(shd);
            for (const x of shd?.[0]?.['Shots-Individual'] || []) {
              shotDetailById[x.AthleteRunningId] = (x.ShotViewDatas || [])
                .map((s: any) => (s.Miss ? '0' : String(s.Scores?.[0] ?? '').trim()))
                .filter((v: string) => v !== '');
            }
          }

          for (const r of arr) {
            const ident = r.AthletesResults?.[0]?.AthleteIdentifier?.Identifier || r.DisplayName;
            if (taken.has(ident)) continue;
            taken.add(ident);
            rows++;
            const athRid = r.AthletesResults?.[0]?.AthleteIdentifier?.RunningId;
            const externalId = `sius:${cid}:${eid}:${sid}:${kind}:${g}:${ident}`;
            // SIUS Result.Value = итог + внутренние десятки одной строкой ("583-24x").
            const rawTotal = String(r.Result?.Value ?? '');
            // Нет итога → это не результат (пустые Qualification Shoot-Off — только места без очков,
            // а также DNS/DNF без результата). Порядок перестрелки уже отражён в основной квалификации.
            if (!rawTotal.trim()) continue;
            const im = rawTotal.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\s*x?$/i);
            const members = isTeam ? (r.AthletesResults || []).map((a: any) => a.DisplayName).filter(Boolean) : null;
            // У командной строки SIUS Nation обычно пуст — берём код страны из состава (у участников он есть).
            const nation = (r.Nation || r.AthletesResults?.[0]?.Nation || '').replace(/\s+\d+$/, '');
            const data: any = {
              externalId,
              eventSlug,
              position: toInt(r.Rank?.DisplayText) ?? 0,
              athleteName: r.DisplayName || '—',
              federationCode: nation || (isTeam ? '' : '—'),
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
            };
            if (!seriesOk) delete data.shots;
            if (!shotsOk) delete data.shotDetail;
            try {
              const existing = await strapi.db.query(RD).findOne({ where: { externalId } });
              if (existing) {
                await strapi.db.query(RD).update({ where: { id: existing.id }, data });
                updated++;
              } else {
                await strapi.db.query(RD).create({ data });
                created++;
              }
              seen.add(externalId);
            } catch (e) {
              complete = false;
              strapi.log.error(`[sius] upsert failed ${externalId}: ${(e as Error).message}`);
            }
          }
        }
        }
        }
        if (complete) cleanPrefixes.push(`sius:${cid}:${eid}:`);
      }
    }

    // Зеркалирование (см. выше): у событий, прочитанных целиком, удаляем строки, которых SIUS
    // больше не отдаёт (исправленные/снятые результаты, стадии старого формата и т.п.).
    if (opts.purge && !opts.activeOnly) {
      for (const prefix of cleanPrefixes) {
        const existing: any[] = await strapi.db
          .query(RD)
          .findMany({ where: { externalId: { $startsWith: prefix } }, select: ['id', 'externalId'], limit: 100000 });
        const staleIds = existing.filter((r) => !seen.has(r.externalId)).map((r) => r.id);
        for (let i = 0; i < staleIds.length; i += 500) {
          const del = await strapi.db.query(RD).deleteMany({ where: { id: { $in: staleIds.slice(i, i + 500) } } });
          purged += del?.count ?? 0;
        }
      }
      if (purged) strapi.log.info(`[sius] removed ${purged} stale rows`);
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
    } finally {
      syncInProgress = false;
    }
  },
}));
