/**
 * БАЗА — приём заявок с сайта.
 *
 * Зачем он нужен. Раньше сайт писал в Telegram сам, и токен бота лежал в
 * исходнике страницы. Любой, кто открыл «просмотр кода», получал право
 * писать от имени бота. Теперь браузер знает только адрес этого обработчика,
 * а токен живёт в секретах воркера и наружу не выходит.
 *
 * Развернуть:
 *   npx wrangler deploy
 *   npx wrangler secret put TG_TOKEN     # токен бота от @BotFather
 *   npx wrangler secret put TG_CHAT      # id чата или канала, куда писать
 *
 * После деплоя подставьте адрес в сайт:
 *   node build/set-lead.mjs https://lead.lllbaza.ru/
 */

const ALLOWED_ORIGINS = [
  'https://lllbaza.ru',
  'https://www.lllbaza.ru'
];

// сколько заявок с одного адреса принимаем за окно
const RATE_LIMIT = 5;
const RATE_WINDOW_S = 600;

// заявка целиком не может быть больше — защита от набивки мусором
const MAX_BODY = 24 * 1024;

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
});

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) }
});

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// строку из формы в сообщение не пускаем целиком: обрезаем и чистим
const clean = (v, max) => esc(String(v == null ? '' : v)).slice(0, max || 160);

const money = (kv) => {
  const v = Number(kv) || 0;
  return v >= 1000
    ? (v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',') + ' млн'
    : new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' тыс';
};

function score(p) {
  let n = 0;
  if (p.when === 'Уже горит') n += 3;
  if (p.when === 'В этом месяце') n += 2;
  if (p.est && p.est.lo > 0) n += 2;
  if (p.est && p.est.lo >= 900) n += 1;
  n += Math.min(2, (p.pains || []).length);
  n += Math.min(2, (p.symptoms || []).length);
  if (p.name) n += 1;
  // Поведение на сайте — такой же сигнал, как ответы в форме: тот, кто
  // просидел десять минут и дочитал до конца, греется сильнее случайного.
  const v = p.visit || {};
  if ((v.sec | 0) >= 300) n += 2; else if ((v.sec | 0) >= 120) n += 1;
  if ((v.deep | 0) >= 80) n += 1;
  if ((v.feed || []).length >= 3) n += 1;
  if (n >= 7) return { ico: '🔥', label: 'ГОРЯЧАЯ ЗАЯВКА' };
  if (n >= 4) return { ico: '⚡', label: 'ТЁПЛАЯ ЗАЯВКА' };
  return { ico: '🌱', label: 'ЗАЯВКА' };
}

function whereFrom(p) {
  const u = p.utm || {};
  const parts = [u.utm_source, u.utm_medium, u.utm_campaign].filter(Boolean).map((x) => clean(x, 60));
  if (parts.length) return parts.join(' / ');
  if (p.ref) { try { return clean(new URL(p.ref).hostname, 80); } catch (e) { return clean(p.ref, 80); } }
  return 'прямой заход';
}

function when(p) {
  try {
    return new Date(p.ts).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return clean(p.ts, 40); }
}

/** Одно сообщение, которое читается за три секунды: сначала — насколько
 *  горячо и кому отвечать, потом задача, и только в конце служебное. */
function render(p) {
  const sc = score(p);
  const RULE = '➖➖➖➖➖➖➖➖➖➖';
  const L = [];
  L.push(sc.ico + ' <b>' + sc.label + '</b>  ·  <code>' + clean(p.code, 24) + '</code>');
  L.push(RULE);
  L.push('👤 <b>' + (clean(p.name, 80) || 'Имя не оставили') + '</b>');
  if (p.phone) L.push('📞 <code>' + clean(p.phone, 32) + '</code>');
  if (p.channel) L.push('💬 Отвечать: <b>' + clean(p.channel, 40) + '</b>');

  const b = p.build;
  if (b && Array.isArray(b.items)) {
    L.push('');
    L.push('⚙️ <b>СБОРКА ИЗ КОНФИГУРАТОРА</b>');
    L.push('<b>' + money(b.lo) + ' — ' + money(b.hi) + ' ₽</b>'
      + (b.rush ? '  ·  <b>ускоренно</b>' : ''));
    for (const it of b.items.slice(0, 12)) {
      L.push('• <b>' + clean(it.name, 60) + '</b> — ' + money(it.lo) + '—' + money(it.hi));
      if (Array.isArray(it.opts) && it.opts.length) {
        L.push('   <i>' + it.opts.slice(0, 8).map((o) => clean(o, 40)).join(', ') + '</i>');
      }
    }
    if (b.support) L.push('Поддержка: <b>' + clean(b.support.name, 60) + '</b>, ' + money(b.support.lo) + '—' + money(b.support.hi) + ' ₽/мес');
    if (b.express) L.push('Старт: <b>экспресс-разбор</b> за ' + money(b.express) + ' ₽');
    if (b.hours) L.push('Ручной работы сейчас: <b>≈' + (Number(b.hours) | 0) + ' ч/мес</b>');
    if (b.link && /^https:\/\/[\w.-]*lllbaza\.ru\//.test(b.link)) {
      L.push('<a href="' + esc(b.link) + '">открыть сборку</a>');
    }
  }

  if ((p.tasks || []).length || (p.details || []).length) {
    L.push('');
    L.push('🎯 <b>ЗАДАЧА</b>');
    if ((p.tasks || []).length) L.push(p.tasks.slice(0, 10).map((t) => '<b>' + clean(t, 40) + '</b>').join(' · '));
    if ((p.details || []).length) L.push('<i>' + p.details.slice(0, 16).map((d) => clean(d, 40)).join(', ') + '</i>');
  }

  if (p.when || p.budget) {
    L.push('');
    if (p.when) L.push('⏱ Сроки: <b>' + clean(p.when, 40) + '</b>');
    if (p.budget) L.push('💰 Расчёт: <b>' + clean(p.budget, 40) + '</b>');
  }

  if ((p.pains || []).length) {
    L.push('');
    L.push('🩹 <b>ЧТО БОЛИТ</b>');
    p.pains.slice(0, 8).forEach((x) => L.push('• ' + clean(x, 90)));
  }

  if ((p.symptoms || []).length) {
    L.push('');
    L.push('✅ <b>ОТМЕТИЛ НА САЙТЕ</b> — ' + p.symptoms.length + ' из 4');
    p.symptoms.slice(0, 4).forEach((x) => L.push('• ' + clean(x, 90)));
  }

  if (p.reco) {
    L.push('');
    L.push('🧭 Сайт рекомендовал: <b>' + clean(p.reco, 60) + '</b>'
      + (p.recoPrice ? ' — ' + clean(p.recoPrice, 40) : ''));
  }

  // Как человек вёл себя до заявки. Это не служебное: по времени,
  // глубине и списку разделов сразу видно, с чего начинать разговор.
  const v = p.visit;
  if (v && typeof v === 'object') {
    const sec = Math.max(0, v.sec | 0);
    const mm = Math.floor(sec / 60), ss = sec % 60;
    L.push('');
    L.push('👀 <b>КАК ВЁЛ СЕБЯ НА САЙТЕ</b>');
    L.push('Провёл <b>' + (mm ? mm + ' мин ' : '') + ss + ' с</b>, дочитал до <b>' + Math.max(0, Math.min(100, v.deep | 0)) + ' %</b>');
    if (Array.isArray(v.seen) && v.seen.length) {
      L.push('Разделы: <i>' + v.seen.slice(0, 12).map((x) => clean(x, 24)).join(' → ') + '</i>');
    }
    if (Array.isArray(v.feed) && v.feed.length) {
      L.push('Смотрел работы: <i>' + v.feed.slice(0, 10).map((x) => clean(x, 24)).join(', ') + '</i>');
    }
    if (v.dev) L.push('Устройство: <b>' + clean(v.dev, 40) + '</b>');
  }

  L.push('');
  L.push(RULE);
  L.push('📍 ' + whereFrom(p) + '  ·  🕓 ' + when(p));
  // Согласия — не формальность: без первого заявку обрабатывать нельзя,
  // а второе решает, можно ли слать этому человеку что-то помимо ответа.
  if (p.consent && typeof p.consent === 'object') {
    L.push('📄 Согласие на ПД: <b>' + (p.consent.pd ? 'да' : 'НЕТ') + '</b>'
      + '  ·  реклама: <b>' + (p.consent.ads ? 'разрешил' : 'не разрешил') + '</b>');
  }
  return L.join('\n');
}

/** Частота: считаем в KV, если он подключён. Без KV ограничения нет —
 *  воркер об этом честно сообщает в логе, а не делает вид, что защищён. */
async function overLimit(env, ip) {
  if (!env.LEADS_KV || !ip) return false;
  const key = 'rl:' + ip;
  const n = Number(await env.LEADS_KV.get(key)) || 0;
  if (n >= RATE_LIMIT) return true;
  await env.LEADS_KV.put(key, String(n + 1), { expirationTtl: RATE_WINDOW_S });
  return false;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'forbidden' }, 403, origin);

    if (!env.TG_TOKEN || !env.TG_CHAT) {
      console.error('lead: TG_TOKEN / TG_CHAT не заданы — заявка не доставлена');
      return json({ ok: false, error: 'not_configured' }, 503, origin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ ok: false, error: 'too_large' }, 413, origin);

    let p;
    try { p = JSON.parse(raw); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400, origin); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return json({ ok: false, error: 'bad_json' }, 400, origin);

    // без единого контакта заявка бесполезна — и это самый дешёвый фильтр от ботов
    if (!p.phone && !p.name) return json({ ok: false, error: 'empty' }, 400, origin);

    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (await overLimit(env, ip)) return json({ ok: false, error: 'rate_limited' }, 429, origin);

    const res = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TG_CHAT,
        text: render(p),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    if (!res.ok) {
      // наружу — общий ответ, подробности только в лог
      console.error('lead: telegram ' + res.status);
      return json({ ok: false, error: 'delivery_failed' }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  }
};
