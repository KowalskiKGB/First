import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createBrazilLocationsRoutes } from '../brazil-locations.js';

const json = (res, status, body) => Object.assign(res, { status, body });

async function invoke(routes, key, url = key.slice(key.indexOf(' ') + 1)) {
  const res = {};
  await routes[key]({ url }, res);
  return res;
}

test('returns all 27 Brazilian states as stable code and name pairs', async () => {
  const routes = createBrazilLocationsRoutes({ json, fetchImpl: () => assert.fail('states must not call IBGE') });

  const response = await invoke(routes, 'GET /api/locations/states');

  assert.equal(response.status, 200);
  assert.equal(response.body.states.length, 27);
  assert.deepEqual(response.body.states[0], { code: 'AC', name: 'Acre' });
  assert.deepEqual(response.body.states.at(-1), { code: 'TO', name: 'Tocantins' });
  assert.deepEqual(new Set(response.body.states.map(state => state.code)).size, 27);
  assert.ok(response.body.states.some(state => state.code === 'CE' && state.name === 'Ceará'));
});

test('rejects a missing or unknown UF before making an upstream request', async () => {
  let requests = 0;
  const routes = createBrazilLocationsRoutes({ json, fetchImpl: async () => { requests += 1; } });

  const missing = await invoke(routes, 'GET /api/locations/municipalities');
  const invented = await invoke(routes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=ZZ');

  assert.deepEqual({ status: missing.status, body: missing.body }, { status: 400, body: { error: 'UF inválida.' } });
  assert.deepEqual({ status: invented.status, body: invented.body }, { status: 400, body: { error: 'UF inválida.' } });
  assert.equal(requests, 0);
});

test('maps, sanitizes and orders IBGE municipalities, using only the fixed official endpoint', async () => {
  const seen = [];
  const routes = createBrazilLocationsRoutes({
    json,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        json: async () => [
          { id: 2307650, nome: '  Maracanaú  ', internal: { mustNotLeak: true } },
          null,
          { id: 'invalid', nome: 'Descartar' },
          { id: 2304400, nome: 'Fortaleza', extra: 'não retornar' },
          { id: 2304400, nome: 'Duplicada' },
          { id: 1, nome: '' }
        ]
      };
    }
  });

  const response = await invoke(
    routes,
    'GET /api/locations/municipalities',
    '/api/locations/municipalities?uf=ce&url=https://attacker.example'
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    uf: 'CE',
    municipalities: [
      { id: 2304400, name: 'Fortaleza' },
      { id: 2307650, name: 'Maracanaú' }
    ]
  });
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].url,
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados/CE/municipios?orderBy=nome'
  );
  assert.equal(seen[0].options.headers.Accept, 'application/json');
  assert.ok(seen[0].options.signal instanceof AbortSignal);
});

test('keeps a bounded in-memory cache per UF', async () => {
  let requests = 0;
  const rows = Array.from({ length: 1_010 }, (_, index) => ({ id: index + 1, nome: `Município ${index + 1}` }));
  const routes = createBrazilLocationsRoutes({
    json,
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => rows };
    }
  });

  const first = await invoke(routes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=SP');
  first.body.municipalities[0].name = 'alterado pelo consumidor';
  const cached = await invoke(routes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=sp');

  assert.equal(requests, 1);
  assert.equal(cached.body.municipalities.length, 1_000);
  assert.notEqual(cached.body.municipalities[0].name, 'alterado pelo consumidor');
});

test('coalesces concurrent requests and cools down repeated upstream failures per UF', async () => {
  let requests = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const routes = createBrazilLocationsRoutes({
    json,
    fetchImpl: async () => {
      requests += 1;
      return pending;
    }
  });

  const first = invoke(routes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=CE');
  const second = invoke(routes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=CE');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests, 1);
  release({ ok: true, json: async () => [{ id: 2304400, nome: 'Fortaleza' }] });
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.deepEqual(secondResponse.body, firstResponse.body);

  let clock = 1_000;
  let failures = 0;
  const failingRoutes = createBrazilLocationsRoutes({
    json,
    now: () => clock,
    failureCooldownMs: 60_000,
    fetchImpl: async () => {
      failures += 1;
      return { ok: false };
    }
  });
  const firstFailure = await invoke(failingRoutes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=RR');
  const cooledDown = await invoke(failingRoutes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=RR');
  const safeFailure = {
    status: 502,
    body: { error: 'Não foi possível carregar os municípios. Digite o município manualmente.' }
  };
  assert.deepEqual({ status: firstFailure.status, body: firstFailure.body }, safeFailure);
  assert.deepEqual({ status: cooledDown.status, body: cooledDown.body }, safeFailure);
  assert.equal(failures, 1);
  clock += 60_001;
  const retried = await invoke(failingRoutes, 'GET /api/locations/municipalities', '/api/locations/municipalities?uf=RR');
  assert.deepEqual({ status: retried.status, body: retried.body }, safeFailure);
  assert.equal(failures, 2);
});

test('returns one fixed public error for upstream failures and timeouts', async () => {
  const leaked = 'upstream secret body';
  const rejectedRoutes = createBrazilLocationsRoutes({
    json,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => leaked })
  });
  const timeoutRoutes = createBrazilLocationsRoutes({
    json,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error(leaked), { name: 'AbortError' })), { once: true });
    })
  });

  const upstreamFailure = await invoke(
    rejectedRoutes,
    'GET /api/locations/municipalities',
    '/api/locations/municipalities?uf=CE'
  );
  const timeout = await invoke(
    timeoutRoutes,
    'GET /api/locations/municipalities',
    '/api/locations/municipalities?uf=CE'
  );

  const safe = {
    status: 502,
    body: { error: 'Não foi possível carregar os municípios. Digite o município manualmente.' }
  };
  assert.deepEqual({ status: upstreamFailure.status, body: upstreamFailure.body }, safe);
  assert.deepEqual({ status: timeout.status, body: timeout.body }, safe);
  assert.equal(JSON.stringify([upstreamFailure.body, timeout.body]).includes(leaked), false);
});

test('registers both public location routes in the HTTP server', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(source, /createBrazilLocationsRoutes/);
  assert.match(source, /Object\.assign\(routes,[\s\S]*createBrazilLocationsRoutes/);
});

test('reverse geocoding accepts valid coordinates, coalesces rounded keys and returns only locality attribution', async () => {
  let requests = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const routes = createBrazilLocationsRoutes({
    json,
    reverseMinIntervalMs: 0,
    fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(url, 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=0.035&lon=-51.07&addressdetails=1');
      assert.match(options.headers['User-Agent'], /First/);
      return pending;
    }
  });
  const first = invoke(routes, 'GET /api/location/reverse', '/api/location/reverse?latitude=0.0346&longitude=-51.0696');
  const second = invoke(routes, 'GET /api/location/reverse', '/api/location/reverse?latitude=0.0347&longitude=-51.0697&url=https://attacker.example');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests, 1);
  release({ ok: true, json: async () => ({ address: { state: 'Amapá', city: 'Macapá', postcode: '68900-000' } }) });
  const [one, two] = await Promise.all([first, second]);
  const expected = { state: 'AP', city: 'Macapá', attribution: '© OpenStreetMap contributors' };
  assert.deepEqual(one.body, expected);
  assert.deepEqual(two.body, expected);
  assert.equal(JSON.stringify(one.body).includes('0.03'), false);
});

test('reverse geocoding rejects malformed coordinates without fetch and returns one fixed public error on failure', async () => {
  let requests = 0;
  const routes = createBrazilLocationsRoutes({
    json,
    reverseMinIntervalMs: 0,
    fetchImpl: async () => { requests += 1; throw new Error('secret upstream coordinates'); }
  });
  const invalid = await invoke(routes, 'GET /api/location/reverse', '/api/location/reverse?latitude=200&longitude=0');
  assert.deepEqual({ status: invalid.status, body: invalid.body }, { status: 400, body: { error: 'Localização inválida.' } });
  assert.equal(requests, 0);
  const unavailable = await invoke(routes, 'GET /api/location/reverse', '/api/location/reverse?latitude=0.03&longitude=-51.07');
  assert.deepEqual({ status: unavailable.status, body: unavailable.body }, {
    status: 502, body: { error: 'Não foi possível identificar sua localização. Selecione manualmente.' }
  });
  assert.equal(JSON.stringify(unavailable.body).includes('secret'), false);
});

test('reverse geocoding allows only configured HTTPS hosts and does not coerce missing coordinates to zero', async () => {
  assert.throws(() => createBrazilLocationsRoutes({
    json, reverseUrl: 'https://attacker.example/reverse', reverseAllowedHosts: ['nominatim.openstreetmap.org']
  }), /allowlisted/);
  let requests = 0;
  const routes = createBrazilLocationsRoutes({ json, fetchImpl: async () => { requests += 1; } });
  const missing = await invoke(routes, 'GET /api/location/reverse', '/api/location/reverse?latitude=&longitude=');
  assert.deepEqual({ status: missing.status, body: missing.body }, { status: 400, body: { error: 'Localização inválida.' } });
  assert.equal(requests, 0);
});
