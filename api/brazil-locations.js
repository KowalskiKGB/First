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

export function createBrazilLocationsRoutes({
  json,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  failureCooldownMs = 60_000,
  now = () => Date.now()
}) {
  const cache = new Map();
  const inFlight = new Map();
  const failureUntil = new Map();
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
    }
  };
}
