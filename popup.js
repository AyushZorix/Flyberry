import { searchFlights, todayIso, addDays } from './src/api.js';
import { AIRPORTS, placeLabel, resolvePlace } from './src/airports.js';
import { getWatches, addWatch, removeWatch, checkWatches, watchKey, formatPrice } from './src/watches.js';
import { getKey, setKey, accountInfo, airportsFor, searchGoogle, loadSellers } from './src/google.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['from', 'to', 'depart', 'ret', 'adults', 'cabin', 'currency'];
const CHECKS = ['direct', 'flex'];
const VIEWS = ['search', 'watching', 'settings'];
const SOURCE_NAME = { kiwi: 'Kiwi.com', google: 'Google Flights' };

// items: every fare found, from all sources, cheapest first
let state = { params: null, items: [], currency: 'INR', fetchedAt: 0, sort: 'price', notice: '' };
let watches = [];
let serpKey = '';
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
const link = (href, text, cls) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: cls }, text);

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

const travellers = (n) => `${n} adult${n > 1 ? 's' : ''}`;
const byPrice = (a, b) => a.price - b.price;

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

function saveLastSearch(form) {
  const { params, items, currency, fetchedAt, notice } = state;
  const payload = { params, items, currency, fetchedAt, notice };
  if (form) payload.form = form;
  chrome.storage.local.get('lastSearch').then(({ lastSearch }) =>
    chrome.storage.local.set({ lastSearch: { ...(lastSearch || {}), ...payload } }));
}

async function runSearch() {
  const form = readForm();
  const today = todayIso();
  if (form.depart < today) return setStatus('The departure date is in the past. Pick today or later.', 'error');
  if (form.ret && form.ret < form.depart) return setStatus('The return date is before the departure date.', 'error');
  const params = toSearchParams(form);
  if (params.from.toLowerCase() === params.to.toLowerCase()) return setStatus('From and To are the same place.', 'error');

  const seq = ++searchSeq;
  const stale = () => seq !== searchSeq;
  const btn = $('search-btn');
  btn.disabled = true;
  btn.textContent = 'Searching live prices…';
  $('results').hidden = true;
  setStatus('Checking live prices. This usually takes 5 to 15 seconds.', 'loading');
  chrome.storage.local.set({ form });

  try {
    // 1. Kiwi.com (no key needed)
    let kiwi = [];
    let kiwiError = '';
    let currency = params.currency || 'INR';
    try {
      const result = await searchFlights(params);
      kiwi = result.itineraries.map((it) => ({ ...it, source: 'kiwi' }));
      currency = result.currency;
    } catch (err) {
      kiwiError = err.message;
    }
    if (stale()) return;
    state = { params, items: kiwi, currency, fetchedAt: Date.now(), sort: 'price', notice: '' };
    if (kiwi.length) {
      setStatus(serpKey ? 'Adding Google Flights fares…' : '', 'loading');
      renderResults();
    }

    // 2. Google Flights (only with the user's key)
    const airports = serpKey && airportsFor(params, kiwi);
    if (airports) {
      try {
        const google = await searchGoogle(params, airports, serpKey);
        if (stale()) return;
        state.items = [...kiwi, ...google].sort(byPrice);
        if (params.flex && google.length) state.notice = `Google Flights fares are for ${niceDate(params.depart)} only.`;
      } catch (err) {
        if (stale()) return;
        state.notice = `Google Flights fares could not be added: ${err.message}`;
      }
    }

    if (!state.items.length) {
      setStatus(kiwiError || 'No flights found for this search. Check the spelling of the places, try other dates, or turn off "Non-stop only".', 'error');
      return;
    }
    setStatus('');
    renderResults();
    saveLastSearch(form);

    // 3. Seller prices for the cheapest Google fare, so the best seller shows without a click
    const topGoogle = state.items.find((it) => it.source === 'google');
    if (topGoogle) showSellers(topGoogle, seq);
  } finally {
    if (!stale()) {
      btn.disabled = false;
      btn.textContent = 'Find cheapest flights';
    }
  }
}

// ---------- sellers (who sells a Google Flights fare, and for how much) ----------

async function showSellers(it, seq = searchSeq) {
  it.sellersOpen = true;
  if (it.sellers || it.sellersLoading) return renderResults();
  it.sellersLoading = true;
  it.sellersError = '';
  renderResults();
  try {
    const { sellers, inbound } = await loadSellers(it, state.params, serpKey);
    it.sellers = sellers;
    if (inbound) it.inbound = inbound;
  } catch (err) {
    it.sellersError = err.message;
  } finally {
    it.sellersLoading = false;
  }
  if (seq !== searchSeq) return;
  renderResults();
  saveLastSearch();
}

/** Seller booking links are POST requests, so they are opened by submitting a form. */
function openBooking(request) {
  if (!safeUrl(request.url)) return;
  const form = h('form', { method: 'post', action: request.url, target: '_blank', hidden: true });
  for (const [name, value] of new URLSearchParams(request.postData)) {
    form.append(h('input', { type: 'hidden', name, value }));
  }
  document.body.append(form);
  form.submit();
  form.remove();
}

function sellerPanel(it, currency) {
  if (it.sellersLoading) return h('div', { class: 'sellers' }, h('div', { class: 'seller-note' }, h('span', { class: 'spinner' }), ' Getting prices from each seller…'));
  if (it.sellersError) return h('div', { class: 'sellers' }, h('div', { class: 'seller-note err' }, it.sellersError));
  if (!it.sellers) return null;
  const best = it.sellers.find((s) => s.price != null);
  return h('div', { class: 'sellers' },
    h('div', { class: 'sellers-title' }, `Price by seller (${it.sellers.length})`),
    it.sellers.map((s) => h('div', { class: `seller${s === best ? ' best' : ''}` },
      h('div', { class: 'seller-name' },
        s.name,
        s.isAirline && h('span', { class: 'tag' }, 'Airline'),
        s === best && h('span', { class: 'tag good' }, 'Lowest'),
        s.fare && h('div', { class: 'seller-fare' }, s.fare)),
      h('div', { class: 'seller-price' }, s.price != null ? formatPrice(s.price, currency) : 'See site'),
      s.requests.length
        ? s.requests.map((r) => h('button', { class: 'book small', onclick: () => openBooking(r) }, r.label ? `Book ${r.label.toLowerCase()}` : 'Book'))
        : h('span', { class: 'seller-fare' }, s.phone ? `Call ${s.phone}` : '')),
    ),
  );
}

// ---------- results ----------

function airlines(leg) {
  return [...new Set(leg.segments.map((s) => s.carrierName || s.carrier))].join(' + ');
}

function flightNumbers(leg) {
  return leg.segments.map((s) => s.flightNumber).filter(Boolean).join(', ');
}

function stopsText(leg) {
  if (!leg.stops) return 'Non-stop';
  const via = leg.route.slice(1, -1).join(', ');
  return `${leg.stops} stop${leg.stops > 1 ? 's' : ''}${via ? ` via ${via}` : ''}`;
}

function legRow(leg, label) {
  const gap = dayGap(leg.departureTime, leg.arrivalTime);
  const numbers = flightNumbers(leg);
  return h('div', { class: 'leg' },
    h('div', { class: 'date' }, `${label ? `${label} · ` : ''}${niceDate(leg.departureTime)} · ${airlines(leg)}${numbers ? ` · ${numbers}` : ''}`),
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
  const isReturn = !!it.inbound || it.isReturn;
  const google = it.source === 'google';
  const url = safeUrl(it.bookingUrl);
  return h('article', { class: `card${cheapest ? ' is-cheapest' : ''}` },
    h('div', { class: 'card-top' },
      h('div', { class: 'badges' },
        cheapest && h('span', { class: 'badge cheap' }, 'Cheapest'),
        fastest && h('span', { class: 'badge fast' }, 'Fastest')),
      h('div', { class: 'price-wrap' },
        h('div', { class: 'price' }, formatPrice(it.price, currency)),
        h('div', { class: `source ${it.source}` }, `on ${SOURCE_NAME[it.source]}`))),
    legRow(it.outbound, isReturn ? 'Out' : ''),
    it.inbound && legRow(it.inbound, 'Back'),
    google && isReturn && !it.inbound && h('div', { class: 'leg-note' }, 'Return-trip price. Compare sellers to see the return flight.'),
    google
      ? h('div', { class: 'card-foot' },
        h('span', {}, 'Lowest price Google lists'),
        h('button', {
          class: 'secondary small push',
          onclick: () => (it.sellersOpen ? ((it.sellersOpen = false), renderResults()) : showSellers(it)),
        }, it.sellersOpen ? 'Hide sellers' : 'Compare sellers'))
      : h('div', { class: 'card-foot' },
        h('span', {}, baggageText(it.baggage)),
        url && link(url, 'Book on Kiwi.com', 'book')),
    google && it.sellersOpen && sellerPanel(it, currency),
  );
}

/** The same search opened directly on each site, for a manual cross-check. */
function siteLinks(p, sample) {
  const out = sample.outbound;
  const from = out.from;
  const to = out.to;
  const dmy = (iso, sep) => iso.split('-').reverse().join(sep);
  const segs = out.segments;
  const abroad = segs[0].fromCountry && segs[0].fromCountry !== segs[segs.length - 1].toCountry;
  const n = p.adults;
  const cabin = p.cabin || 'M';

  const mmt = `https://www.makemytrip.com/flight/search?itinerary=${from}-${to}-${dmy(p.depart, '/')}${p.ret ? `_${to}-${from}-${dmy(p.ret, '/')}` : ''}&tripType=${p.ret ? 'R' : 'O'}&paxType=A-${n}_C-0_I-0&intl=${abroad}&cabinClass=${{ M: 'E', W: 'PE', C: 'B', F: 'F' }[cabin]}`;
  const ixigo = `https://www.ixigo.com/search/result/flight?from=${from}&to=${to}&date=${dmy(p.depart, '')}${p.ret ? `&returnDate=${dmy(p.ret, '')}` : ''}&adults=${n}&children=0&infants=0&class=${{ M: 'e', W: 'w', C: 'b', F: 'f' }[cabin]}&source=Search+Form`;
  const cleartrip = `https://www.cleartrip.com/flights/results?adults=${n}&childs=0&infants=0&class=${encodeURIComponent({ M: 'Economy', W: 'Premium Economy', C: 'Business', F: 'First' }[cabin])}&depart_date=${dmy(p.depart, '/')}${p.ret ? `&return_date=${dmy(p.ret, '/')}` : ''}&from=${from}&to=${to}&intl=${abroad ? 'y' : 'n'}`;
  const google = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${p.depart}${p.ret ? ` through ${p.ret}` : ' one way'}`)}`;
  const ymd = (iso) => iso.slice(2).replaceAll('-', '');
  const sky = `https://www.skyscanner.net/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${ymd(p.depart)}/${p.ret ? `${ymd(p.ret)}/` : ''}?adultsv2=${n}`;

  return h('div', { class: 'links' },
    'Open this search on ',
    [['MakeMyTrip', mmt], ['ixigo', ixigo], ['Cleartrip', cleartrip], ['Google Flights', google], ['Skyscanner', sky]]
      .flatMap(([name, href], i) => [i ? ' · ' : '', link(href, name)]));
}

function watchControls(p, cheapestKiwi, currency) {
  if (!cheapestKiwi) return null;
  if (watches.some((w) => w.key === watchKey(p))) {
    return h('div', { class: 'tools' }, h('button', { class: 'secondary', disabled: true }, 'Watching this route ✓'));
  }
  const target = h('input', { type: 'number', min: '0', step: '1', placeholder: `Target ${currency}`, 'aria-label': `Optional target price in ${currency}` });
  const add = h('button', {
    class: 'secondary',
    onclick: async () => {
      watches = await addWatch(p, cheapestKiwi, Number(target.value) || null);
      renderWatchCount();
      renderResults();
    },
  }, 'Watch this price');
  return h('div', { class: 'tools' }, add, target);
}

/** The lowest price anywhere: listed fares plus any seller prices already loaded. */
function bestDeal(items) {
  let best = { price: items[0].price, where: SOURCE_NAME[items[0].source], it: items[0] };
  for (const it of items) {
    const seller = it.sellers?.find((s) => s.price != null);
    if (seller && seller.price < best.price) best = { price: seller.price, where: seller.name, it };
  }
  return best;
}

function renderResults() {
  const { params: p, items, currency, fetchedAt, sort, notice } = state;
  const box = $('results');
  if (!items?.length) {
    box.hidden = true;
    return;
  }
  const cheapest = items[0];
  const speed = (it) => it.outbound.durationSeconds;
  const fastest = items.reduce((a, b) => (speed(b) < speed(a) ? b : a));
  const list = sort === 'duration' ? [...items].sort((a, b) => speed(a) - speed(b) || a.price - b.price) : items;
  const kiwi = items.filter((it) => it.source === 'kiwi');
  const hasGoogle = items.some((it) => it.source === 'google');
  const deal = bestDeal(items);

  // City names come from Kiwi; Google only gives airport codes.
  const named = kiwi[0]?.outbound.segments;
  const title = named
    ? `${named[0].fromCity}, ${named[0].fromCountry} → ${named[named.length - 1].toCity}, ${named[named.length - 1].toCountry}`
    : `${cheapest.outbound.from} → ${cheapest.outbound.to}`;
  const dates = p.flex
    ? `around ${niceDate(p.depart)} (±3 days)`
    : `${niceDate(p.depart)}${p.ret ? ` – ${niceDate(p.ret)}` : ''}`;
  const sources = [kiwi.length && `${kiwi.length} from Kiwi.com`, hasGoogle && `${items.length - kiwi.length} from Google Flights`].filter(Boolean).join(', ');

  const sortChip = (key, text) => h('button', {
    class: `chip${sort === key ? ' active' : ''}`,
    onclick: () => { state.sort = key; renderResults(); },
  }, text);

  box.replaceChildren(
    h('div', { class: 'summary' },
      h('div', {},
        h('h2', {}, title),
        h('div', { class: 'sub' }, `${p.ret ? 'Return' : 'One way'} · ${dates} · ${travellers(p.adults)}${p.direct ? ' · non-stop only' : ''}`)),
      h('div', { class: 'best-line' },
        h('strong', {}, formatPrice(deal.price, currency)),
        'cheapest, on ', h('b', {}, deal.where),
        ` · ${airlines(deal.it.outbound)}${p.flex ? ` · ${niceDate(deal.it.outbound.departureTime)}` : ''}${p.adults > 1 ? ` · total for ${travellers(p.adults)}` : ''}`),
      !serpKey && h('div', { class: 'tip' },
        'These prices are from Kiwi.com only. To see what MakeMyTrip, Cleartrip, ixigo and other sellers charge for each flight, ',
        h('button', { class: 'inline-link', onclick: () => showView('settings') }, 'add a free key in Settings'), '.'),
      notice && h('div', { class: 'tip warn' }, notice),
      watchControls(p, kiwi[0], currency),
      siteLinks(p, kiwi[0] || cheapest)),
    h('div', { class: 'sortbar' },
      'Sort', sortChip('price', 'Cheapest'), sortChip('duration', 'Fastest'),
      h('span', { class: 'fresh' }, `Live prices from ${ago(fetchedAt)}`)),
    h('div', { class: 'sortbar' }, `${items.length} options: ${sources}`),
    ...list.map((it) => flightCard(it, { cheapest: it === cheapest, fastest: it === fastest, currency })),
    h('p', { class: 'note' }, 'Prices are fetched live when you search. The final price is confirmed on the seller\'s booking page.'),
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
    h('div', { class: 'watch-price' },
      h('span', { class: 'now' }, formatPrice(w.lastPrice, currency)),
      h('span', { class: 'source kiwi' }, 'on Kiwi.com'),
      delta),
    h('div', { class: 'watch-sub' }, facts),
    w.expired && h('div', { class: 'watch-err' }, 'The departure date has passed. Remove this watch.'),
    w.error && !w.expired && h('div', { class: 'watch-err' }, `Last check failed: ${w.error}`),
    h('div', { class: 'watch-actions' },
      url && !w.expired && link(url, 'Book on Kiwi.com', 'book'),
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

// ---------- settings ----------

function keyStatus(message, kind) {
  const box = $('key-status');
  box.hidden = !message;
  box.className = `key-status ${kind || ''}`;
  box.textContent = message || '';
}

function renderSettings() {
  $('serp-key').value = serpKey;
  $('remove-key').hidden = !serpKey;
  $('tab-settings').classList.toggle('needs-setup', !serpKey);
}

async function saveKey() {
  const key = $('serp-key').value.trim();
  if (!key) return keyStatus('Paste your API key first.', 'bad');
  const btn = $('save-key');
  btn.disabled = true;
  keyStatus('Checking the key…');
  try {
    const { searchesLeft } = await accountInfo(key);
    await setKey(key);
    serpKey = key;
    keyStatus(`Key saved and working.${searchesLeft != null ? ` ${searchesLeft} searches left this month.` : ''} Your next search will include seller prices.`, 'good');
  } catch (err) {
    keyStatus(err.message, 'bad');
  } finally {
    btn.disabled = false;
    renderSettings();
    renderResults();
  }
}

function showView(name) {
  for (const view of VIEWS) {
    const on = view === name;
    $(`view-${view}`).hidden = !on;
    $(`tab-${view}`).classList.toggle('active', on);
    $(`tab-${view}`).setAttribute('aria-selected', String(on));
  }
  if (name === 'watching') renderWatches();
  if (name === 'settings') renderSettings();
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
  serpKey = await getKey();
  if (stored.form) {
    fillForm(stored.form);
    if ($('depart').value < today) {
      $('depart').value = addDays(today, 14);
      $('ret').value = '';
    }
  }
  const last = stored.lastSearch;
  // Show the previous results again only while they are still reasonably fresh.
  if (last?.items?.length && last.params?.depart >= today && Date.now() - last.fetchedAt < 30 * 60000) {
    state = { params: last.params, items: last.items, currency: last.currency, fetchedAt: last.fetchedAt, sort: 'price', notice: last.notice || '' };
    for (const it of state.items) it.sellersLoading = false;
    renderResults();
  }
  renderWatchCount();
  renderSettings();

  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
  $('depart').addEventListener('change', () => {
    $('ret').min = $('depart').value || today;
    if ($('ret').value && $('ret').value < $('depart').value) $('ret').value = '';
  });
  $('swap').addEventListener('click', () => {
    [$('from').value, $('to').value] = [$('to').value, $('from').value];
  });
  for (const view of VIEWS) $(`tab-${view}`).addEventListener('click', () => showView(view));
  $('open-tab').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') }));
  $('key-form').addEventListener('submit', (e) => { e.preventDefault(); saveKey(); });
  $('remove-key').addEventListener('click', async () => {
    await setKey('');
    serpKey = '';
    keyStatus('Key removed. Searches now use Kiwi.com only.');
    renderSettings();
    renderResults();
  });
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
