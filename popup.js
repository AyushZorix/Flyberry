import { searchFlights, todayIso, addDays } from './src/api.js';
import { AIRPORTS, placeLabel, resolvePlace } from './src/airports.js';
import { getWatches, addWatch, removeWatch, checkWatches, watchKey, routeName, formatPrice } from './src/watches.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['from', 'to', 'depart', 'ret', 'adults', 'cabin', 'currency'];
const CHECKS = ['direct', 'flex'];

let state = { params: null, result: null, fetchedAt: 0, sort: 'price' };
let watches = [];
let searchSeq = 0;

// ---------- small helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

const safeUrl = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

function duration(seconds) {
  const mins = Math.round(seconds / 60);
  const hrs = Math.floor(mins / 60);
  return hrs ? `${hrs}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

function niceDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayGap(fromIso, toIso) {
  const day = (s) => Date.UTC(...s.slice(0, 10).split('-').map((n, i) => (i === 1 ? n - 1 : Number(n))));
  return Math.round((day(toIso) - day(fromIso)) / 86400000);
}

function ago(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
}

function travellers(n) {
  return `${n} adult${n > 1 ? 's' : ''}`;
}

// ---------- form ----------

function readForm() {
  const p = {};
  for (const id of FIELDS) p[id] = $(id).value.trim();
  for (const id of CHECKS) p[id] = $(id).checked;
  p.adults = Number(p.adults) || 1;
  return p;
}

function fillForm(p) {
  for (const id of FIELDS) if (p[id] != null) $(id).value = p[id];
  for (const id of CHECKS) $(id).checked = !!p[id];
}

/** Form values -> what the search actually runs with (place names turned into codes). */
function toSearchParams(form) {
  return { ...form, from: resolvePlace(form.from), to: resolvePlace(form.to) };
}

function setStatus(message, kind) {
  const box = $('status');
  box.hidden = !message;
  box.className = `status${kind === 'error' ? ' error' : ''}`;
  box.replaceChildren(...(message ? [kind === 'loading' ? h('span', { class: 'spinner' }) : null, h('span', {}, message)].filter(Boolean) : []));
}

async function runSearch() {
  const form = readForm();
  const today = todayIso();
  if (form.depart < today) return setStatus('The departure date is in the past. Pick today or later.', 'error');
  if (form.ret && form.ret < form.depart) return setStatus('The return date is before the departure date.', 'error');
  const params = toSearchParams(form);
  if (params.from.toLowerCase() === params.to.toLowerCase()) return setStatus('From and To are the same place.', 'error');

  const seq = ++searchSeq;
  const btn = $('search-btn');
  btn.disabled = true;
  btn.textContent = 'Searching live prices…';
  $('results').hidden = true;
  setStatus('Checking live prices. This usually takes 5 to 15 seconds.', 'loading');
  chrome.storage.local.set({ form });

  try {
    const result = await searchFlights(params);
    if (seq !== searchSeq) return;
    state = { params, result, fetchedAt: Date.now(), sort: 'price' };
    chrome.storage.local.set({ lastSearch: { form, params, result, fetchedAt: state.fetchedAt } });
    if (!result.itineraries.length) {
      setStatus('No flights found for this search. Check the spelling of the places, try other dates, or turn off "Non-stop only".', 'error');
    } else {
      setStatus('');
      renderResults();
    }
  } catch (err) {
    if (seq !== searchSeq) return;
    setStatus(err.message, 'error');
  } finally {
    if (seq === searchSeq) {
      btn.disabled = false;
      btn.textContent = 'Find cheapest flights';
    }
  }
}

// ---------- results ----------

function airlines(leg) {
  return [...new Set(leg.segments.map((s) => s.carrierName || s.carrier))].join(' + ');
}

function stopsText(leg) {
  if (!leg.stops) return 'Non-stop';
  const via = leg.route.slice(1, -1).join(', ');
  return `${leg.stops} stop${leg.stops > 1 ? 's' : ''}${via ? ` via ${via}` : ''}`;
}

function legRow(leg, label) {
  const gap = dayGap(leg.departureTime, leg.arrivalTime);
  return h('div', { class: 'leg' },
    h('div', { class: 'date' }, `${label ? `${label} · ` : ''}${niceDate(leg.departureTime)} · ${airlines(leg)}`),
    h('div', { class: 'times' },
      `${leg.departureTime.slice(11, 16)} ${leg.from} → ${leg.arrivalTime.slice(11, 16)} ${leg.to}`,
      gap > 0 ? ` (+${gap}d)` : ''),
    h('div', { class: 'meta' }, `${duration(leg.durationSeconds)} · ${stopsText(leg)}`),
  );
}

function baggageText(b) {
  if (!b) return '';
  const parts = [];
  if (b.cabinBag) parts.push('cabin bag');
  if (b.checkedBag) parts.push('checked bag');
  return parts.length ? `Includes ${parts.join(' + ')}` : 'Personal item only';
}

function flightCard(it, { cheapest, fastest, currency }) {
  const isReturn = !!it.inbound;
  const url = safeUrl(it.bookingUrl);
  return h('article', { class: `card${cheapest ? ' is-cheapest' : ''}` },
    h('div', { class: 'card-top' },
      h('div', { class: 'badges' },
        cheapest && h('span', { class: 'badge cheap' }, 'Cheapest'),
        fastest && h('span', { class: 'badge fast' }, 'Fastest')),
      h('div', { class: 'price' }, formatPrice(it.price, currency))),
    legRow(it.outbound, isReturn ? 'Out' : ''),
    isReturn && legRow(it.inbound, 'Back'),
    h('div', { class: 'card-foot' },
      h('span', {}, baggageText(it.baggage)),
      url && h('a', { class: 'book', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Book')),
  );
}

function compareLinks(p, cheapest) {
  const out = cheapest.outbound;
  const google = `https://www.google.com/travel/flights?q=${encodeURIComponent(
    `Flights from ${out.from} to ${out.to} on ${p.depart}${p.ret ? ` through ${p.ret}` : ' one way'}`)}`;
  const ymd = (iso) => iso.slice(2).replaceAll('-', '');
  const sky = `https://www.skyscanner.net/transport/flights/${out.from.toLowerCase()}/${out.to.toLowerCase()}/${ymd(p.depart)}/${p.ret ? `${ymd(p.ret)}/` : ''}?adultsv2=${p.adults}`;
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  return h('div', { class: 'links' }, 'Double-check this price on ', link(google, 'Google Flights'), ' or ', link(sky, 'Skyscanner'));
}

function watchControls(p, cheapest, currency) {
  const existing = watches.find((w) => w.key === watchKey(p));
  if (existing) {
    return h('div', { class: 'tools' }, h('button', { class: 'secondary', disabled: true }, 'Watching this route ✓'));
  }
  const target = h('input', { type: 'number', min: '0', step: '1', placeholder: `Target ${currency}`, 'aria-label': `Optional target price in ${currency}` });
  const add = h('button', {
    class: 'secondary',
    onclick: async () => {
      watches = await addWatch(p, cheapest, Number(target.value) || null);
      renderWatchCount();
      renderResults();
    },
  }, 'Watch this price');
  return h('div', { class: 'tools' }, add, target);
}

function renderResults() {
  const { params: p, result, fetchedAt, sort } = state;
  const box = $('results');
  if (!result?.itineraries?.length) {
    box.hidden = true;
    return;
  }
  const currency = result.currency;
  const all = result.itineraries;
  const cheapest = all[0];
  const fastest = all.reduce((a, b) => (b.totalDurationSeconds < a.totalDurationSeconds ? b : a));
  const list = sort === 'duration' ? [...all].sort((a, b) => a.totalDurationSeconds - b.totalDurationSeconds || a.price - b.price) : all;

  const segs = cheapest.outbound.segments;
  const first = segs[0];
  const last = segs[segs.length - 1];
  const dates = p.flex
    ? `around ${niceDate(p.depart)} (±3 days)`
    : `${niceDate(p.depart)}${p.ret ? ` – ${niceDate(p.ret)}` : ''}`;

  const sortChip = (key, text) => h('button', {
    class: `chip${sort === key ? ' active' : ''}`,
    onclick: () => { state.sort = key; renderResults(); },
  }, text);

  box.replaceChildren(
    h('div', { class: 'summary' },
      h('div', {},
        h('h2', {}, `${first.fromCity}, ${first.fromCountry} → ${last.toCity}, ${last.toCountry}`),
        h('div', { class: 'sub' }, `${p.ret ? 'Return' : 'One way'} · ${dates} · ${travellers(p.adults)}${p.direct ? ' · non-stop only' : ''}`)),
      h('div', { class: 'best-line' },
        h('strong', {}, formatPrice(cheapest.price, currency)),
        `cheapest${p.adults > 1 ? ` total for ${travellers(p.adults)}` : ''} · ${airlines(cheapest.outbound)}${p.flex ? ` · ${niceDate(cheapest.outbound.departureTime)}` : ''}`),
      watchControls(p, cheapest, currency),
      compareLinks(p, cheapest)),
    h('div', { class: 'sortbar' },
      'Sort', sortChip('price', 'Cheapest'), sortChip('duration', 'Fastest'),
      h('span', { class: 'fresh' }, `${all.length} options · prices from ${ago(fetchedAt)}`)),
    ...list.map((it) => flightCard(it, { cheapest: it === cheapest, fastest: it === fastest, currency })),
    h('p', { class: 'note' }, 'Live prices from Kiwi.com. The final price is confirmed on the booking page.'),
  );
  box.hidden = false;
}

// ---------- watching ----------

function renderWatchCount() {
  const badge = $('watch-count');
  badge.hidden = !watches.length;
  badge.textContent = watches.length;
}

function watchCard(w) {
  const p = w.params;
  const currency = p.currency || 'INR';
  const diff = w.lastPrice - w.startPrice;
  const delta = diff < 0
    ? h('span', { class: 'delta down' }, `▼ ${formatPrice(-diff, currency)} since you started watching`)
    : diff > 0
      ? h('span', { class: 'delta up' }, `▲ ${formatPrice(diff, currency)} since you started watching`)
      : h('span', { class: 'delta flat' }, 'No change since you started watching');
  const url = safeUrl(w.bookingUrl);
  const details = [
    p.ret ? `${niceDate(p.depart)} – ${niceDate(p.ret)}` : niceDate(p.depart),
    p.flex && '±3 days',
    travellers(p.adults || 1),
    p.direct && 'non-stop',
  ].filter(Boolean).join(' · ');
  const facts = [
    `Lowest seen ${formatPrice(w.lowest, currency)}`,
    w.target && `Target ${formatPrice(w.target, currency)}`,
    `Checked ${ago(w.lastChecked)}`,
  ].filter(Boolean).join(' · ');

  return h('article', { class: 'card' },
    h('div', {},
      h('div', { class: 'watch-title' }, w.label),
      h('div', { class: 'watch-sub' }, details)),
    h('div', { class: 'watch-price' }, h('span', { class: 'now' }, formatPrice(w.lastPrice, currency)), delta),
    h('div', { class: 'watch-sub' }, facts),
    w.expired && h('div', { class: 'watch-err' }, 'The departure date has passed. Remove this watch.'),
    w.error && !w.expired && h('div', { class: 'watch-err' }, `Last check failed: ${w.error}`),
    h('div', { class: 'watch-actions' },
      url && !w.expired && h('a', { class: 'book', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Book'),
      !w.expired && h('button', {
        class: 'secondary',
        onclick: () => { fillForm(p); showView('search'); runSearch(); },
      }, 'See all flights'),
      h('button', {
        class: 'linklike',
        onclick: async () => { watches = await removeWatch(w.id); renderWatches(); renderResults(); },
      }, 'Remove')),
  );
}

function renderWatches() {
  renderWatchCount();
  $('check-now').hidden = !watches.length;
  $('watch-list').replaceChildren(
    ...(watches.length
      ? watches.map(watchCard)
      : [h('div', { class: 'empty' }, 'Nothing watched yet. Run a search, then press "Watch this price" to track it.')]),
  );
}

function showView(name) {
  for (const view of ['search', 'watching']) {
    const on = view === name;
    $(`view-${view}`).hidden = !on;
    $(`tab-${view}`).classList.toggle('active', on);
    $(`tab-${view}`).setAttribute('aria-selected', String(on));
  }
  if (name === 'watching') renderWatches();
}

// ---------- start ----------

async function init() {
  if (new URLSearchParams(location.search).has('tab')) document.body.classList.add('in-tab');

  $('places').replaceChildren(...AIRPORTS.map((a) => h('option', { value: placeLabel(a) })));
  const today = todayIso();
  $('depart').min = today;
  $('ret').min = today;
  $('depart').value = addDays(today, 14);

  const stored = await chrome.storage.local.get(['form', 'lastSearch', 'watches']);
  watches = stored.watches || [];
  if (stored.form) {
    fillForm(stored.form);
    if ($('depart').value < today) {
      $('depart').value = addDays(today, 14);
      $('ret').value = '';
    }
  }
  const last = stored.lastSearch;
  // Show the previous results again only while they are still reasonably fresh.
  if (last?.result && last.params?.depart >= today && Date.now() - last.fetchedAt < 30 * 60000) {
    state = { params: last.params, result: last.result, fetchedAt: last.fetchedAt, sort: 'price' };
    renderResults();
  }
  renderWatchCount();

  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
  $('depart').addEventListener('change', () => {
    $('ret').min = $('depart').value || today;
    if ($('ret').value && $('ret').value < $('depart').value) $('ret').value = '';
  });
  $('swap').addEventListener('click', () => {
    [$('from').value, $('to').value] = [$('to').value, $('from').value];
  });
  $('tab-search').addEventListener('click', () => showView('search'));
  $('tab-watching').addEventListener('click', () => showView('watching'));
  $('open-tab').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') }));
  $('check-now').addEventListener('click', async () => {
    const btn = $('check-now');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      watches = await checkWatches();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check all now';
      renderWatches();
    }
  });
}

init();
