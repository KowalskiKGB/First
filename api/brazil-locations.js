const IBGE_MUNICIPALITIES = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const MAX_MUNICIPALITIES = 1_000;
const PUBLIC_UPSTREAM_ERROR = 'Não foi possível carregar os municípios. Digite o município manualmente.';

const STATES = Object.freeze([
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'],
  ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins']
].map(([code, name]) => Object.freeze({ code, name })));
const STATE_CODES = new Set(STATES.map(state => state.code));
const STATE_BY_NAME = new Map(STATES.map(state => [state.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(), state.code]));
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const REVERSE_ERROR = 'Não foi possível identificar sua localização. Selecione manualmente.';
const REVERSE_ATTRIBUTION = '© OpenStreetMap contributors';

export const isBrazilStateCode = value => STATE_CODES.has(value);

function cleanMunicipalities(rows) {
  if (!Array.isArray(rows)) throw new TypeError('invalid IBGE response');
  const seen = new Set();
  const municipalities = [];
  for (const row of rows) {
    const id = row?.id;
    const name = typeof row?.nome === 'string' ? row.nome.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !name || seen.has(id)) continue;
    seen.add(id);
    municipalities.push({ id, name });
  }
  return municipalities
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id - b.id)
    .slice(0, MAX_MUNICIPALITIES);
}

function reverseCoordinate(value, min, max) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function reverseLocality(payload) {
  const address = payload?.address;
  if (!address || typeof address !== 'object' || Array.isArray(address)) throw new TypeError('invalid Nominatim response');
  const stateName = String(address.state || '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const state = STATE_BY_NAME.get(stateName) || (/^br-[a-z]{2}$/i.test(address.state_code || '') ? address.state_code.slice(-2).toUpperCase() : '');
  const city = [address.city, address.town, address.municipality, address.village]
    .find(value => typeof value === 'string' && value.trim());
  if (!state || !city) throw new TypeError('missing Nominatim locality');
  return { state, city: city.trim().replace(/\s+/g, ' ').slice(0, 100), attribution: REVERSE_ATTRIBUTION };
}

export function createBrazilLocationsRoutes({
  json,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  failureCooldownMs = 60_000,
  now = () => Date.now(),
  reverseUrl = NOMINATIM_REVERSE,
  reverseUserAgent = 'First gym directory/1.0 (+https://github.com/KowalskiKGB/First)',
  reverseMinIntervalMs = 1_000,
  reverseAllowedHosts = ['nominatim.openstreetmap.org']
}) {
  const reverseEndpoint = new URL(reverseUrl);
  if (reverseEndpoint.protocol !== 'https:') throw new TypeError('reverse geocoder must use HTTPS');
  const allowedHosts = new Set((Array.isArray(reverseAllowedHosts) ? reverseAllowedHosts : String(reverseAllowedHosts).split(','))
    .map(host => String(host).trim().toLowerCase()).filter(Boolean));
  if (!allowedHosts.has(reverseEndpoint.hostname.toLowerCase())) throw new TypeError('reverse geocoder host is not allowlisted');
  const cache = new Map();
  const inFlight = new Map();
  const failureUntil = new Map();
  const reverseCache = new Map();
  const reverseInFlight = new Map();
  let nextReverseAt = 0;
  let reverseQueue = Promise.resolve();
  const copy = municipalities => municipalities.map(item => ({ ...item }));
  const loadMunicipalities = uf => {
    if (cache.has(uf)) return Promise.resolve(cache.get(uf));
    if ((failureUntil.get(uf) || 0) > now()) return Promise.reject(new Error('IBGE temporarily unavailable'));
    if (inFlight.has(uf)) return inFlight.get(uf);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    const pending = (async () => {
      try {
        const response = await fetchImpl(`${IBGE_MUNICIPALITIES}/${uf}/municipios?orderBy=nome`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response?.ok) throw new Error('IBGE request failed');
        const municipalities = cleanMunicipalities(await response.json());
        cache.set(uf, municipalities);
        failureUntil.delete(uf);
        return municipalities;
      } catch (error) {
        failureUntil.set(uf, now() + Math.max(1, failureCooldownMs));
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })();
    inFlight.set(uf, pending);
    pending.finally(() => inFlight.delete(uf)).catch(() => {});
    return pending;
  };
  const loadReverse = (latitude, longitude) => {
    const key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
    if (reverseCache.has(key)) return Promise.resolve(reverseCache.get(key));
    if (reverseInFlight.has(key)) return reverseInFlight.get(key);
    const runReverse = async () => {
      const delay = Math.max(0, nextReverseAt - now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      nextReverseAt = now() + Math.max(0, reverseMinIntervalMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      try {
        const url = new URL(reverseEndpoint);
        url.search = new URLSearchParams({
          format: 'jsonv2', lat: String(Number(latitude.toFixed(3))), lon: String(Number(longitude.toFixed(3))), addressdetails: '1'
        }).toString();
        const response = await fetchImpl(url.toString(), {
          headers: { Accept: 'application/json', 'User-Agent': reverseUserAgent }, signal: controller.signal
        });
        if (!response?.ok) throw new Error('Nominatim request failed');
        const locality = reverseLocality(await response.json());
        if (reverseCache.size >= 1_000) reverseCache.delete(reverseCache.keys().next().value);
        reverseCache.set(key, locality);
        return locality;
      } finally {
        clearTimeout(timer);
      }
    };
    const pending = reverseQueue.then(runReverse);
    reverseQueue = pending.catch(() => {});
    reverseInFlight.set(key, pending);
    pending.finally(() => reverseInFlight.delete(key)).catch(() => {});
    return pending;
  };

  return {
    'GET /api/locations/states': (_req, res) => json(res, 200, {
      states: STATES.map(state => ({ ...state }))
    }),

    'GET /api/locations/municipalities': async (req, res) => {
      const uf = (new URL(req.url, 'http://first.local').searchParams.get('uf') || '').trim().toUpperCase();
      if (!isBrazilStateCode(uf)) return json(res, 400, { error: 'UF inválida.' });
      if (cache.has(uf)) return json(res, 200, { uf, municipalities: copy(cache.get(uf)) });

      try {
        const municipalities = await loadMunicipalities(uf);
        return json(res, 200, { uf, municipalities: copy(municipalities) });
      } catch {
        return json(res, 502, { error: PUBLIC_UPSTREAM_ERROR });
      }
    },

    'GET /api/location/reverse': async (req, res) => {
      const query = new URL(req.url, 'http://first.local').searchParams;
      const latitude = reverseCoordinate(query.get('latitude'), -90, 90);
      const longitude = reverseCoordinate(query.get('longitude'), -180, 180);
      if (latitude === null || longitude === null) return json(res, 400, { error: 'Localização inválida.' });
      try {
        const locality = await loadReverse(latitude, longitude);
        return json(res, 200, { ...locality });
      } catch {
        return json(res, 502, { error: REVERSE_ERROR });
      }
    }
  };
}
