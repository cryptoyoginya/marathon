// Общий код валидатора и рендерера: парсинг YAML-шапки plan.md и выполнение
// plan-data.js. Шапка — ограниченное подмножество YAML: скаляры, flow-списки
// в одну строку, блок-список inline-словарей (phases). Ключи стабильные,
// поэтому полный парсер не нужен.

export function parseScalar(s) {
  s = s.trim();
  if (s === 'null' || s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

// элементы через запятую верхнего уровня (не внутри {} и [])
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseInline(s) {
  s = s.trim();
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    for (const part of splitTop(s.slice(1, -1))) {
      const i = part.indexOf(':');
      obj[part.slice(0, i).trim()] = parseInline(part.slice(i + 1));
    }
    return obj;
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1);
    return inner.trim() ? splitTop(inner).map(parseInline) : [];
  }
  return parseScalar(s);
}

export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('в plan.md нет YAML-шапки');
  const fm = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const km = line.match(/^([A-Za-z_]\w*):\s*(.*)$/);
    if (!km) continue;
    const key = km[1];
    const val = km[2].replace(/\s+#.*$/, '').trim();
    if (val === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s+- /.test(lines[i + 1]))
        items.push(parseInline(lines[++i].replace(/^\s+- /, '')));
      fm[key] = items.length ? items : null;
    } else {
      fm[key] = parseInline(val);
    }
  }
  return fm;
}

// plan-data.js — один стейтмент `var PLAN = {...};`
export function evalPlanData(code) {
  return new Function(`"use strict"; ${code}; return PLAN;`)();
}

// Смоук собранной страницы: выполняет её скрипт с proxy-заглушкой DOM.
// Ловит класс ошибок «данные прошли проверки, но рантайм падает»
// (битая сшивка, отсутствующее поле, на котором шаблон делает .map и т.п.).
// Кидает исключение, если скрипт страницы падает.
export function smokeRun(html) {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('в plan.html нет блока <script>');
  const handler = {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      return proxy;
    },
    set: () => true,
    apply: () => proxy,
    construct: () => proxy,
  };
  const proxy = new Proxy(function () {}, handler);
  new Function('document', 'window', m[1])(proxy, proxy);
}
