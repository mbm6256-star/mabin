import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import config from './api/config.mjs';
import players from './api/players.mjs';
import matches from './api/matches.mjs';
import { readResponse } from './server/read-api.mjs';

const env = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_TEST_ONLY',
  NODE_ENV: 'development',
  ENABLE_DEV_MATCH_WRITES: 'true'
};
const request = (path, method = 'GET') => new Request('https://tennis.example/api/' + path, { method });

test('public configuration and write rejection are independent of local write flags', async () => {
  const status = await config.fetch(request('config'));
  assert.deepEqual(await status.json(), { matchWritesEnabled: false });
  const denial = await matches.fetch(request('matches', 'POST'));
  assert.equal(denial.status, 405);
  assert.equal(denial.headers.get('allow'), 'GET, HEAD');
  let calls = 0;
  const response = await readResponse('matches', 'POST', { env, fetchImpl: () => { calls++; } });
  assert.equal(response.status, 405);
  assert.equal(calls, 0);
});

test('public reads preserve data source, match shape and blank member code', async t => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = env.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
    const rows = url.pathname.endsWith('/players')
      ? [{ id: 'a', name: 'Player A' }, { id: 'b', name: 'Player B' }]
      : [{
          id: '9007199254740993', played_at: '2026-11-01', player_a_id: 'a', player_b_id: 'b',
          winner_id: 'a', match_sets: [
            { set_number: 1, player_a_games: 6, player_b_games: 3 },
            { set_number: 2, player_a_games: 6, player_b_games: 2 }
          ]
        }];
    if (url.pathname.endsWith('/players')) assert.equal(url.searchParams.get('select'), 'id,name');
    return Response.json(rows, { headers: { 'Content-Range': '0-' + (rows.length - 1) + '/' + rows.length } });
  });
  const names = await players.fetch(request('players'));
  assert.equal(names.headers.get('x-data-source'), 'supabase');
  assert.deepEqual(await names.json(), [{ id: 'a', name: 'Player A', memberCode: '' }, { id: 'b', name: 'Player B', memberCode: '' }]);
  const records = await matches.fetch(request('matches'));
  assert.equal(records.status, 200);
  assert.deepEqual(await records.json(), [{
    id: '9007199254740993', date: '2026-11-01', a: 'a', b: 'b', sets: [[6, 3], [6, 2]]
  }]);
  const head = await players.fetch(request('players', 'HEAD'));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(calls, 4);
});

test('public build contains only intended static assets and resolves all local browser modules', async () => {
  execFileSync(process.execPath, ['scripts/build-public.mjs']);
  const assets = await readdir(new URL('./dist/', import.meta.url));
  assert.deepEqual(assets.sort(), [
    'app.js', 'core.js', 'index.html', 'pose-3d.mjs', 'pose-analysis.js', 'pose-compare.mjs',
    'pose-engine.mjs', 'pose-metrics.mjs', 'pose-phases.mjs', 'styles.css'
  ]);
  for (const asset of assets) {
    const text = await readFile(new URL('./dist/' + asset, import.meta.url), 'utf8');
    for (const [, dependency] of text.matchAll(/(?:from\s+|import\()(['"]\.\/[^'"]+['"])/g)) {
      assert(assets.includes(dependency.slice(3, -1)), asset + ' has missing dependency');
    }
    assert.equal(text.includes('SUPABASE_SECRET_KEY'), false);
  }
});
