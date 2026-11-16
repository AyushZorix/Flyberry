// Price watches: saved searches that are re-checked in the background.
import { searchFlights, todayIso } from './api.js';

export const CHECK_ALARM = 'flightyy-watch-check';
export const CHECK_EVERY_MINUTES = 180;
const HISTORY_LIMIT = 60;

export async function getWatches() {
  const { watches = [] } = await chrome.storage.local.get('watches');
  return watches;
}

async function setWatches(watches) {
  await chrome.storage.local.set({ watches });
}

/** Two searches are the same watch when every search option matches. */
export function watchKey(p) {
  return [p.from, p.to, p.depart, p.ret || '', p.adults || 1, p.cabin || 'M', p.currency || 'INR', !!p.direct, !!p.flex]
    .join('|')
    .toLowerCase();
}

export function routeName(itinerary, params) {
  const segs = itinerary?.outbound?.segments;
  if (!segs?.length) return `${params.from} → ${params.to}`;
  return `${segs[0].fromCity} → ${segs[segs.length - 1].toCity}`;
}

export async function addWatch(params, cheapest, target) {
  const watches = await getWatches();
  const key = watchKey(params);
  if (watches.some((w) => w.key === key)) return watches;
  watches.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key,
    params,
    label: routeName(cheapest, params),
    target: target || null,
    startPrice: cheapest.price,
    lastPrice: cheapest.price,
    lowest: cheapest.price,
    bookingUrl: cheapest.bookingUrl,
    lastChecked: Date.now(),
    history: [{ t: Date.now(), price: cheapest.price }],
    error: null,
  });
  await setWatches(watches);
  return watches;
}

export async function removeWatch(id) {
  const watches = (await getWatches()).filter((w) => w.id !== id);
  await setWatches(watches);
  return watches;
}

export function formatPrice(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function notify(watch, title, message) {
  if (!chrome.notifications) return;
  chrome.notifications.create(`watch:${watch.id}:${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 2,
  });
}

/** Re-check every watch and notify on a price drop or when a target is reached. */
export async function checkWatches() {
  const watches = await getWatches();
  const updated = new Map();

  for (const w of watches) {
    const next = { ...w, lastChecked: Date.now() };
    updated.set(w.id, next);
    if (w.params.depart < todayIso() && !w.params.flex) {
      next.expired = true;
      continue;
    }
    try {
      const { itineraries } = await searchFlights(w.params);
      const best = itineraries[0];
      if (!best) {
        next.error = 'No flights found on the last check.';
        continue;
      }
      const prev = w.lastPrice;
      const currency = w.params.currency || 'INR';
      next.error = null;
      next.lastPrice = best.price;
      next.bookingUrl = best.bookingUrl;
      next.lowest = Math.min(w.lowest ?? best.price, best.price);
      next.history = [...(w.history || []), { t: Date.now(), price: best.price }].slice(-HISTORY_LIMIT);

      const reachedTarget = w.target && best.price <= w.target && !(prev <= w.target);
      if (reachedTarget) {
        notify(w, `${w.label}: target reached`, `Now ${formatPrice(best.price, currency)}, at or below your target of ${formatPrice(w.target, currency)}.`);
      } else if (prev && best.price < prev) {
        notify(w, `${w.label}: price dropped`, `Now ${formatPrice(best.price, currency)}, down ${formatPrice(prev - best.price, currency)} from ${formatPrice(prev, currency)}.`);
      }
    } catch (err) {
      next.error = err.message;
    }
  }

  // Merge into whatever is stored now, so a watch removed during the check stays removed.
  const current = await getWatches();
  const merged = current.map((w) => updated.get(w.id) || w);
  await setWatches(merged);
  return merged;
}
