#!/usr/bin/env node
// Регрессионные тесты детерминированного слоя скилла: парсер, валидатор,
// рендерер. Гонять после любой правки скриптов или шаблона:
//   node test.mjs

import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter } from './lib.mjs';
import { validatePlan } from './validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'demo');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

console.log('валидатор:');
const fm = parseFrontmatter(readFileSync(join(fixture, 'plan.md'), 'utf8'));
const base = validatePlan(fm);
check('фикстура без ошибок', base.errors.length === 0);
check('фикстура без предупреждений', base.warns.length === 0);

const errs = patch => validatePlan({ ...fm, ...patch }).errors.length > 0;
const warnsOf = patch => validatePlan({ ...fm, ...patch }).warns.length > 0;
check('ловит неверную длину volume_km', errs({ volume_km: fm.volume_km.slice(1) }));
check('ловит длинную больше объёма', errs({ long_km: [25, ...fm.long_km.slice(1)] }));
check('ловит длинную больше 55% объёма', errs({ long_km: [12, ...fm.long_km.slice(1)] }));
check('ловит дыру в фазах', errs({ phases: fm.phases.map((p, i) => i === 1 ? { ...p, from: p.from + 1 } : p) }));
check('ловит дату забега вне последней недели', errs({ race_date: '2026-05-01' }));
check('ловит длинную выше потолка дистанции', errs({ long_km: fm.long_km.map((x, i) => i === 8 ? 22 : x) }));
check('предупреждает о росте объёма больше 10%', warnsOf({ volume_km: fm.volume_km.map((x, i) => i === 8 ? 30 : x) }));
check('предупреждает о разгрузке не ниже соседней', warnsOf({ volume_km: fm.volume_km.map((x, i) => i === 3 ? 23 : x) }));
check('предупреждает о скачке длинной больше 2 км', warnsOf({ long_km: fm.long_km.map((x, i) => i === 4 ? 12 : x) }));
check('предупреждает об отсутствии подводки', warnsOf({ volume_km: fm.volume_km.map((x, i) => i === 10 ? 28 : x) }));
check('предупреждает о негоночной последней неделе', warnsOf({ long_km: fm.long_km.map((x, i) => i === 11 ? 12 : x) }));
check('предупреждает о goal time без времени', warnsOf({ goal: 'time' }));

const warnHas = (patch, sub) => validatePlan({ ...fm, ...patch }).warns.some(w => w.includes(sub));
check('ловит нечитаемую дату забега', errs({ race_date: 'скоро' }));
check('ловит нулевой объём недели', errs({ volume_km: fm.volume_km.map((x, i) => i === 2 ? 0 : x) }));
check('ловит нечисло в массиве', errs({ long_km: fm.long_km.map((x, i) => i === 1 ? 'пять' : x) }));
check('предупреждает о дублях разгрузок', warnHas({ deload_weeks: [4, 4, 8] }, 'дубли'));
check('предупреждает о пике не по цели', warnHas({ goal: 'time', goal_time: '1:55' }, 'пиковый объём'));
check('предупреждает о сроке меньше минимума', warnHas({ distance_km: 42.2 }, 'минимума'));

console.log('рендерер:');
const tmp = mkdtempSync(join(tmpdir(), 'marathon-test-'));
try {
  cpSync(fixture, tmp, { recursive: true });
  execFileSync('node', [join(here, 'render.mjs'), tmp], { stdio: 'pipe' });
  check('собирает plan.html без ошибок', existsSync(join(tmp, 'plan.html')));
  const html = readFileSync(join(tmp, 'plan.html'), 'utf8');
  check('в странице PLAN фикстуры', html.includes('"Демо"') && html.includes('конец PLAN'));
  check('разметка шаблона на месте', html.includes('id="rail"') && html.includes('pdfbtn'));

  // рассинхрон PLAN и plan.md должен валить сборку
  const data = readFileSync(join(tmp, 'plan-data.js'), 'utf8');
  const broken = patch => {
    writeFileSync(join(tmp, 'plan-data.js'), patch(data));
    try { execFileSync('node', [join(here, 'render.mjs'), tmp], { stdio: 'pipe' }); return false; }
    catch { return true; }
  };
  check('ловит рассинхрон PLAN и plan.md', broken(d => d.replace('weeks: 12', 'weeks: 13')));
  check('ловит отсутствие easyPace при разгрузках', broken(d => d.replace(/^.*easyPace.*\n/m, '')));
  check('ловит отсутствие desc у карточки', broken(d => d.replace('"Темповая":"Разминка', '"Темповая-нет":"Разминка')));
  check('ловит темп у небеговой карточки', broken(d => d.replace('ti:"Йога",                 val:40', 'ti:"Йога", pc:"6:00/км", val:40')));
  check('ловит питание без источника', broken(d => d.replace(', s:"Jeukendrup"}', '}')));
  let threw;

  // сломанный plan-data.js не должен ронять рендерер молча
  writeFileSync(join(tmp, 'plan-data.js'), 'var PLAN = {');
  threw = false;
  try { execFileSync('node', [join(here, 'render.mjs'), tmp], { stdio: 'pipe' }); }
  catch { threw = true; }
  check('ловит невалидный plan-data.js', threw);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fail ? `провал: ${fail} из ${pass + fail}` : `ок: все ${pass} тестов прошли`);
process.exit(fail ? 1 : 0);
