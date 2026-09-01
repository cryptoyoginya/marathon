#!/usr/bin/env node
// Сборка plan.html: шаблон + plan-data.js. Перед сшивкой гоняет валидатор
// plan.md, сверяет числа PLAN с YAML-шапкой и проверяет структуру PLAN.
// Пишет plan.html только если ошибок нет.
// Запуск: node render.mjs <папка человека>

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, evalPlanData } from './lib.mjs';
import { validatePlan } from './validate.mjs';

const dir = process.argv[2];
if (!dir) { console.error('нужен путь: node render.mjs <папка человека>'); process.exit(2); }

const fm = parseFrontmatter(readFileSync(join(dir, 'plan.md'), 'utf8'));
const dataCode = readFileSync(join(dir, 'plan-data.js'), 'utf8');
let P;
try { P = evalPlanData(dataCode); }
catch (e) { console.error('✗ plan-data.js не выполняется: ' + e.message); process.exit(1); }

const errors = [], warns = [];
const err = m => errors.push(m);
const warn = m => warns.push(m);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. Инварианты plan.md
const v = validatePlan(fm);
errors.push(...v.errors);
warns.push(...v.warns);

// 2. PLAN сходится с YAML-шапкой (источник правды — plan.md)
if (P.name !== fm.name) err(`PLAN.name «${P.name}» ≠ name «${fm.name}»`);
if (P.weeks !== fm.weeks_total) err(`PLAN.weeks ${P.weeks} ≠ weeks_total ${fm.weeks_total}`);
if (P.startDate !== fm.start_date) err(`PLAN.startDate ${P.startDate} ≠ start_date ${fm.start_date}`);
if (P.distance !== fm.distance_km) err(`PLAN.distance ${P.distance} ≠ distance_km ${fm.distance_km}`);
if (P.gender !== fm.gender) err(`PLAN.gender ${P.gender} ≠ gender ${fm.gender}`);
if (!eq(P.volume, fm.volume_km)) err('PLAN.volume не совпадает с volume_km');
if (!eq(P.longRun, fm.long_km)) err('PLAN.longRun не совпадает с long_km');
if (fm.vo2max && fm.vo2max.length) {
  if (!P.vo2max || P.vo2max.length !== fm.vo2max.length ||
    P.vo2max.some((x, i) => Math.abs(x - fm.vo2max[i]) > 0.01))
    err('PLAN.vo2max не совпадает с vo2max');
} else if (P.vo2max && P.vo2max.length) {
  err('в PLAN есть vo2max, а в plan.md нет');
}
if (!eq(Object.keys(P.pauseWeeks || {}).map(Number).sort((a, b) => a - b), (fm.pause_weeks || []).slice().sort((a, b) => a - b)))
  err('PLAN.pauseWeeks не совпадает с pause_weeks');
if (!eq((P.deloadWeeks || []).slice().sort((a, b) => a - b), fm.deload_weeks.slice().sort((a, b) => a - b)))
  err('PLAN.deloadWeeks не совпадает с deload_weeks');
if ((P.phases || []).length !== fm.phases.length) err('число фаз в PLAN и plan.md разное');
else fm.phases.forEach((p, i) => {
  const q = P.phases[i];
  if (q.name !== p.name || q.from !== p.from || q.to !== p.to)
    err(`фаза ${p.name}: в PLAN ${q.name} ${q.from}-${q.to}, в plan.md ${p.from}-${p.to}`);
});

// 3. Структура PLAN под шаблон
if (!['f', 'm'].includes(P.gender)) err('PLAN.gender должен быть f или m');
if (typeof P.minPerKm !== 'number') err('PLAN.minPerKm должен быть числом');
if (!P.zones || P.zones.length !== 5) err('PLAN.zones: нужно 5 зон');
for (const p of P.phases || []) {
  const s = (P.sessions || {})[p.name];
  if (!s || !s.length) { err(`нет сессий для фазы ${p.name}`); continue; }
  // беговые сессии: длинная (long) и доли объёма (share)
  const runs = s.filter(x => x.long || x.share).length;
  if (runs !== fm.runs_per_week)
    warn(`фаза ${p.name}: беговых сессий ${runs}, а runs_per_week ${fm.runs_per_week}`);
  if (s.filter(x => x.long).length !== 1) err(`фаза ${p.name}: длинная должна быть ровно одна`);
  const recs = (P.recs || {})[p.name];
  if (!recs || !recs.length) err(`нет рекомендаций для фазы ${p.name}`);
}
// оборот есть у каждой карточки; на разгрузке интервалы станут «Лёгкий бег»
const tis = new Set();
for (const arr of Object.values(P.sessions || {})) for (const s of arr) tis.add(s.ti);
for (const s of P.pauseSessions || []) tis.add(s.ti);
if (fm.deload_weeks.length && [...tis].includes('Интервалы')) tis.add('Лёгкий бег');
for (const ti of tis) if (!(P.desc || {})[ti]) err(`нет описания (desc) для карточки «${ti}»`);
for (const m of P.milestones || [])
  if (m.week != null && (m.week < 1 || m.week > P.weeks)) err(`веха «${m.label}»: неделя ${m.week} вне плана`);
if ((P.milestones || []).length && P.milestones[P.milestones.length - 1].week !== P.weeks)
  warn('последняя веха не на последней неделе (обычно это забег)');
if (!P.nutrition || !P.nutrition.length) err('пустой блок nutrition');
if (!P.trouble || !P.trouble.length) err('пустой блок trouble');
if (!P.method) err('нет строки method');

for (const w of warns) console.log('⚠  ' + w);
for (const e of errors) console.log('✗ ' + e);
if (errors.length) {
  console.log(`провал: ошибок ${errors.length}, plan.html не собран`);
  process.exit(1);
}

// 4. Сшивка: в шаблоне заменяется только блок PLAN, разметка нетронута
const tpl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'plan-template.html'), 'utf8');
const startIdx = tpl.indexOf('var PLAN = {');
const endMark = '/* ================= конец PLAN ================= */';
const endIdx = tpl.indexOf(endMark);
if (startIdx < 0 || endIdx < 0) { console.error('✗ в шаблоне не найден блок PLAN'); process.exit(1); }
const html = tpl.slice(0, startIdx) + dataCode.trimEnd() + '\n' + tpl.slice(endIdx);
writeFileSync(join(dir, 'plan.html'), html);
console.log(`ок: plan.html собран (${html.length} байт)` + (warns.length ? `, предупреждений ${warns.length}` : ''));
