// Google Flights data through SerpApi (needs the user's own free API key).
// Used for two things: a second source of live fares, and the per-seller
// price breakdown (MakeMyTrip, Cleartrip, ixigo, the airline, ...) for a flight.

const SEARCH_URL = 'https://serpapi.com/search.json';
const ACCOUNT_URL = 'https://serpapi.com/account.json';
const CABIN = { M: '1', W: '2', C: '3', F: '4' };
const COUNTRY = { INR: 'in', USD: 'us', GBP: 'uk', AED: 'ae', SGD: 'sg', AUD: 'au', CAD: 'ca', THB: 'th', JPY: 'jp', EUR: 'de' };
const AIRPORT_CODES = /^[A-Z]{3}(,[A-Z]{3})*$/;

export async function getKey() {
  const { serpKey = '' } = await chrome.storage.local.get('serpKey');
  return serpKey;
}

export async function setKey(key) {
  if (key) await chrome.storage.local.set({ serpKey: key });
  else await chrome.storage.local.remove('serpKey');
}

async function getJson(url, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let data;
  try {
    response = await fetch(url, { signal: controller.signal });
    data = await response.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Google Flights took too long to answer.');
    throw new Error('Could not reach the Google Flights data service.');
  } finally {
    clearTimeout(timer);
  }
  if (data?.error) {
    if (response.status === 401) throw new Error('The API key was not accepted. Check it in Settings.');
    if (response.status === 429) throw new Error('Your monthly Google Flights searches are used up.');
    throw new Error(data.error);
  }
  if (!response.ok) throw new Error(`Google Flights data service error (HTTP ${response.status}).`);
  return data;
}

function search(key, params) {
  return getJson(`${SEARCH_URL}?${new URLSearchParams({ engine: 'google_flights', api_key: key, ...params })}`);
}

/** Checks a key and reports how many searches are left this month. */
export async function accountInfo(key) {
  const data = await getJson(`${ACCOUNT_URL}?${new URLSearchParams({ api_key: key })}`, 20000);
  return { searchesLeft: data.total_searches_left ?? data.plan_searches_left ?? null };
}

function baseParams(p, airports) {
  const currency = p.currency || 'INR';
  const params = {
    departure_id: airports.from,
    arrival_id: airports.to,
    outbound_date: p.depart,
    type: p.ret ? '1' : '2',
    currency,
    hl: 'en',
    gl: COUNTRY[currency] || 'us',
    adults: String(p.adults || 1),
    travel_class: CABIN[p.cabin] || '1',
  };
  if (p.ret) params.return_date = p.ret;
  return params;
}

// "2026-12-10 07:10" -> "2026-12-10T07:10:00"
const isoTime = (t) => `${String(t).replace(' ', 'T')}:00`;

function toLeg(item) {
  const segments = item.flights.map((f) => ({
    from: f.departure_airport.id,
    to: f.arrival_airport.id,
    fromName: f.departure_airport.name,
    toName: f.arrival_airport.name,
    departureTime: isoTime(f.departure_airport.time),
    arrivalTime: isoTime(f.arrival_airport.time),
    durationSeconds: (f.duration || 0) * 60,
    carrierName: f.airline,
    flightNumber: f.flight_number,
  }));
  const last = segments[segments.length - 1];
  return {
    from: segments[0].from,
    to: last.to,
    departureTime: segments[0].departureTime,
    arrivalTime: last.arrivalTime,
    durationSeconds: (item.total_duration || 0) * 60,
    stops: segments.length - 1,
    route: [segments[0].from, ...segments.map((s) => s.to)],
    segments,
  };
}

const flightsOf = (data) => [...(data.best_flights || []), ...(data.other_flights || [])]
  .filter((item) => Number.isFinite(item.price) && item.flights?.length);

/**
 * Which airports to ask Google for. Google needs airport codes, so city codes
 * and typed names are replaced by the airports the Kiwi results actually used.
 */
export function airportsFor(p, kiwiItineraries) {
  const seen = (pick) => [...new Set(kiwiItineraries.map(pick))].slice(0, 5).join(',');
  const from = seen((it) => it.outbound.from) || (AIRPORT_CODES.test(p.from) ? p.from : '');
  const to = seen((it) => it.outbound.to) || (AIRPORT_CODES.test(p.to) ? p.to : '');
  return from && to ? { from, to } : null;
}

/** Live Google Flights fares, cheapest first, in the same shape as the Kiwi results. */
export async function searchGoogle(p, airports, key) {
  const params = { ...baseParams(p, airports), sort_by: '2' };
  if (p.direct) params.stops = '1';
  const data = await search(key, params);
  return flightsOf(data)
    .map((item, i) => {
      const outbound = toLeg(item);
      return {
        id: `g${i}`,
        source: 'google',
        price: item.price,
        totalDurationSeconds: outbound.durationSeconds,
        outbound,
        inbound: null,
        isReturn: !!p.ret,
        bookingToken: item.booking_token || null,
        departureToken: item.departure_token || null,
        airports,
      };
    })
    .sort((a, b) => a.price - b.price);
}

function parseOption(option) {
  const parts = option.separate_tickets
    ? [['Out', option.departing], ['Back', option.returning]]
    : [['', option.together]];
  if (parts.some(([, part]) => !part?.book_with)) return null;
  const prices = parts.map(([, part]) => part.price);
  const requests = parts
    .filter(([, part]) => part.booking_request?.url)
    .map(([label, part]) => ({ label, url: part.booking_request.url, postData: part.booking_request.post_data || '' }));
  return {
    name: [...new Set(parts.map(([, part]) => part.book_with))].join(' + '),
    price: prices.every(Number.isFinite) ? prices.reduce((a, b) => a + b, 0) : null,
    isAirline: parts.every(([, part]) => part.airline === true),
    fare: parts[0][1].option_title || '',
    phone: parts[0][1].booking_phone || '',
    requests,
  };
}

/**
 * Who sells this flight and for how much, cheapest first.
 * One-way: 1 search. Return trip: 2 (the cheapest return flight is picked first).
 */
export async function loadSellers(itinerary, p, key) {
  const base = baseParams(p, itinerary.airports);
  let token = itinerary.bookingToken;
  let inbound = null;
  if (!token) {
    if (!itinerary.departureToken) throw new Error('Google has no seller list for this flight.');
    const back = flightsOf(await search(key, { ...base, departure_token: itinerary.departureToken }))
      .filter((item) => item.booking_token)
      .sort((a, b) => a.price - b.price)[0];
    if (!back) throw new Error('Google returned no return flights for this option.');
    token = back.booking_token;
    inbound = toLeg(back);
  }
  const data = await search(key, { ...base, booking_token: token });
  const sellers = (data.booking_options || [])
    .map(parseOption)
    .filter(Boolean)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  if (!sellers.length) throw new Error('Google lists no sellers for this flight.');
  return { sellers, inbound };
}
