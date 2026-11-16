// Live flight search through Kiwi.com's public flight-search endpoint.
// It speaks JSON-RPC (MCP) over HTTP and needs no API key.

const ENDPOINT = 'https://mcp.kiwi.com/';
const FLEX_DAYS = 3;
let rpcId = 0;

export function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// yyyy-mm-dd -> dd/mm/yyyy (the format the endpoint expects)
function toApiDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const later = (a, b) => (a > b ? a : b);

function buildArgs(p) {
  const args = {
    flyFrom: p.from.trim(),
    flyTo: p.to.trim(),
    departureDate: toApiDate(p.depart),
    adults: Number(p.adults) || 1,
    currency: p.currency || 'INR',
    sort: 'price',
    locale: 'en',
  };
  if (p.ret) args.returnDate = toApiDate(p.ret);
  if (p.flex) {
    // Explicit ranges so a window around a near date never reaches into the past.
    const from = later(addDays(p.depart, -FLEX_DAYS), todayIso());
    args.departureDate = toApiDate(from);
    args.departureDateTo = toApiDate(addDays(p.depart, FLEX_DAYS));
    if (p.ret) {
      args.returnDate = toApiDate(later(addDays(p.ret, -FLEX_DAYS), from));
      args.returnDateTo = toApiDate(addDays(p.ret, FLEX_DAYS));
    }
  }
  if (p.direct) args.max_sector_stopovers = 0;
  if (p.cabin && p.cabin !== 'M') args.cabinClass = p.cabin;
  return args;
}

// The endpoint answers either as plain JSON or as a server-sent event stream.
function parseRpcBody(text, contentType) {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text);
  const messages = text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data));
  const reply = messages.find((m) => m.result || m.error);
  if (!reply) throw new Error('The flight service sent an empty reply.');
  return reply;
}

function errorText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.message || value.detail || JSON.stringify(value);
}

/**
 * @param {{from:string,to:string,depart:string,ret?:string,adults?:number,
 *          cabin?:string,currency?:string,direct?:boolean,flex?:boolean}} params
 *   dates are yyyy-mm-dd
 * @returns {Promise<{itineraries:object[],currency:string,query:string}>}
 *   itineraries sorted cheapest first
 */
export async function searchFlights(params, { timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let text;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name: 'search-flight', arguments: buildArgs(params) },
      }),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The search took too long. Please try again.');
    throw new Error('Could not reach the flight service. Check your internet connection.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`The flight service returned an error (HTTP ${response.status}).`);

  let reply;
  try {
    reply = parseRpcBody(text, response.headers.get('content-type') || '');
  } catch {
    throw new Error('The flight service sent a reply that could not be read.');
  }
  if (reply.error) throw new Error(errorText(reply.error) || 'The flight service rejected the search.');

  const result = reply.result || {};
  let data = result.structuredContent;
  if (!data) {
    const raw = (result.content || []).find((c) => c.type === 'text')?.text || '';
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 200) || 'The flight service sent no results.');
    }
  }
  if (result.isError || data.error) {
    throw new Error(errorText(data.error) || 'The flight service could not run this search.');
  }

  const itineraries = (data.itineraries || [])
    .filter((it) => Number.isFinite(it.price) && it.outbound)
    .sort((a, b) => a.price - b.price);
  return { itineraries, currency: data.currency || params.currency || 'INR', query: data.query || '' };
}
