#!/usr/bin/env node
// Валидатор инвариантов plan.md (числа — по references/methodology.md).
// Запуск: node validate.mjs <папка человека>
// Нарушение инварианта — ошибка (exit 1), пограничное — предупреждение.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './lib.mjs';

export function validatePlan(fm) {
  const errors = [], warns = [];
  const err = m => errors.push(m);
  const warn = m => warns.push(m);

  for (const k of ['name', 'distance_km', 'race_date', 'start_date', 'weeks_total',
    'runs_per_week', 'phases', 'deload_weeks', 'volume_km', 'long_km'])
    if (fm[k] == null) err(`нет ключа ${k}`);
  if (errors.length) return { errors, warns };

  const N = fm.weeks_total;
  const vol = fm.volume_km, long = fm.long_km, vo2 = fm.vo2max || [];
  if (vol.length !== N) err(`volume_km: ${vol.length} чисел, а weeks_total ${N}`);
  if (long.length !== N) err(`long_km: ${long.length} чисел, а weeks_total ${N}`);
  if (vo2.length && vo2.length !== N) err(`vo2max: ${vo2.length} чисел, а weeks_total ${N}`);
  if (errors.length) return { errors, warns };

  // фазы подряд и покрывают 1..N
  let cursor = 1;
  for (const p of fm.phases) {
    if (p.from !== cursor) err(`фаза ${p.name}: начинается с ${p.from}, ожидалась ${cursor}`);
    if (p.to < p.from) err(`фаза ${p.name}: to меньше from`);
    cursor = p.to + 1;
  }
  if (cursor - 1 !== N) err(`фазы кончаются на неделе ${cursor - 1}, а недель ${N}`);

  const pause = new Set(fm.pause_weeks || []);
  const deload = new Set(fm.deload_weeks);
  for (const w of [...pause, ...deload])
    if (w < 1 || w > N) err(`служебная неделя ${w} вне диапазона 1..${N}`);

  // дата забега попадает в последнюю неделю плана
  const day = 86400000;
  const lastFrom = new Date(fm.start_date).getTime() + (N - 1) * 7 * day;
  const race = new Date(fm.race_date).getTime();
  if (race < lastFrom || race >= lastFrom + 7 * day)
    err(`race_date ${fm.race_date} не попадает в неделю ${N} (она начинается ${new Date(lastFrom).toISOString().slice(0, 10)})`);

  const isRace = w => Math.abs(long[w - 1] - fm.distance_km) < 0.01;
  const capLong = fm.distance_km > 30 ? 35 : 21; // потолок длинной по дистанции
  let maxV = 0, maxL = 0;

  for (let w = 1; w <= N; w++) {
    const v = vol[w - 1], l = long[w - 1];
    if (l > v) err(`неделя ${w}: длинная ${l} больше объёма ${v}`);
    if (!isRace(w) && l > capLong)
      err(`неделя ${w}: длинная ${l} выше потолка ${capLong} км для дистанции ${fm.distance_km}`);

    // длинная ~45% недели максимум (гоночная и каникулы не в счёт)
    if (!isRace(w) && !pause.has(w)) {
      const r = l / v;
      if (r > 0.55) err(`неделя ${w}: длинная ${l} это ${Math.round(r * 100)}% объёма ${v}`);
      else if (r > 0.47) warn(`неделя ${w}: длинная ${Math.round(r * 100)}% объёма, правило около 45%`);
    }

    // рост в новую зону не больше ~10% (возврат после разгрузки и пауз — не рост)
    if (!pause.has(w) && maxV > 0 && v > maxV * 1.12)
      warn(`неделя ${w}: объём ${v} на ${Math.round((v / maxV - 1) * 100)}% выше прежнего максимума ${maxV}, правило до 10%`);
    if (!pause.has(w) && !isRace(w) && maxL > 0 && l > maxL + 2.2)
      warn(`неделя ${w}: длинная ${l} выросла больше чем на 2 км от максимума ${maxL}`);

    if (deload.has(w) && w > 1 && v >= vol[w - 2])
      warn(`неделя ${w}: разгрузочная, но объём ${v} не ниже предыдущей недели (${vol[w - 2]})`);
    if (pause.has(w) && w > 1 && v > vol[w - 2] * 0.7)
      warn(`неделя ${w}: каникулы, а объём ${v} больше 70% предыдущей недели`);
    if (vo2.length && w > 1 && vo2[w - 1] - vo2[w - 2] > 1.5)
      warn(`неделя ${w}: скачок VO₂max ${vo2[w - 2]} → ${vo2[w - 1]}`);

    if (!pause.has(w)) {
      maxV = Math.max(maxV, v);
      if (!isRace(w)) maxL = Math.max(maxL, l);
    }
  }

  // гоночная неделя и подводка
  if (!isRace(N))
    warn(`длинная последней недели ${long[N - 1]} не равна дистанции ${fm.distance_km}, а это гоночная неделя`);
  if (N >= 3) {
    const peak = Math.max(...vol.slice(0, N - 1));
    if (vol[N - 2] > peak * 0.7)
      warn(`неделя ${N - 1}: объём ${vol[N - 2]} больше 70% пика ${peak}, подводка требует снижения на 30-50%`);
  }
  if (fm.goal === 'time' && fm.goal_time == null) warn('goal: time, но goal_time пуст');
  if (fm.distance_km > 30 && fm.runs_per_week < 3)
    warn('марафон при менее чем 3 беговых в неделю — по методике этого мало');
  if (fm.vo2max_start != null && vo2.length && Math.abs(vo2[0] - fm.vo2max_start) > 0.6)
    warn(`первое значение vo2max ${vo2[0]} далеко от vo2max_start ${fm.vo2max_start}`);

  return { errors, warns };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error('нужен путь: node validate.mjs <папка человека>'); process.exit(2); }
  const fm = parseFrontmatter(readFileSync(join(dir, 'plan.md'), 'utf8'));
  const { errors, warns } = validatePlan(fm);
  for (const w of warns) console.log('⚠  ' + w);
  for (const e of errors) console.log('✗ ' + e);
  console.log(errors.length
    ? `провал: ошибок ${errors.length}, предупреждений ${warns.length}`
    : `ок: инварианты plan.md держатся` + (warns.length ? `, предупреждений ${warns.length}` : ''));
  process.exit(errors.length ? 1 : 0);
}
