# Local read-only backend setup

1. Copy `.env.example` in the project root to `.env`.
2. Set `SUPABASE_URL` to the HTTPS project URL (no `/rest/v1` path).
3. Set `SUPABASE_SECRET_KEY` to a server-only `sb_secret_...` key from Supabase API Keys.
   Legacy JWT service_role keys are not accepted by this implementation.
4. Restart the local server with `node preview.mjs` (Node 24 recommended).
   The server automatically loads the root `.env`; existing process environment
   variables take precedence. `node --env-file=.env preview.mjs` also works.
5. Open `http://127.0.0.1:4173/api/players` and `/api/matches`.
   Expected for the seeded DB: four players, five matches with ten sets.

Never commit `.env` or put secrets in frontend code, logs, screenshots, or chat.
The existing `.gitignore` excludes `.env` and `.env.*` except `.env.example`.
The static-file allowlist does not serve environment files or server source.

The server uses Supabase's HTTPS Data API to read PostgreSQL tables, not a direct
PostgreSQL socket. Enable the Data API and expose the `public` schema. The server
role must have SELECT access to `players`, `matches`, and `match_sets`.
Secret keys bypass RLS; enabling RLS does not constrain this backend role.
No RLS policies, grants, schema, or database records are changed by this code.
The local server listens only on 127.0.0.1. Reads remain available; development
writes are disabled by default. See docs/경기저장-개발테스트.md for the optional
service-role-only transactional RPC and the local-only POST gate.
Do not publish these unauthenticated routes without reviewing data access.

Check RLS and permissions manually in SQL Editor (read-only):

```sql
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('players', 'matches', 'match_sets');

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('players', 'matches', 'match_sets');

SELECT t.table_name, r.role_name,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT') AS can_select
FROM (VALUES ('players'), ('matches'), ('match_sets')) AS t(table_name)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name);
```

For anon/authenticated, SELECT grants alone do not imply visible rows: RLS
policies also apply. Without a matching policy, those roles cannot read rows.
Live RLS and grant state cannot be determined from server code alone.

Successful APIs return arrays and `X-Data-Source: supabase`.
Players use `{id, name, memberCode}`; nullable member codes become empty strings.
Matches use `{id, date, a, b, sets}`; bigint IDs are cast to text in the Data API
query to preserve precision. Sets are sorted by set_number. Scores, player
references, dates, and stored winners are validated before returning matches.
Top-level pagination is fetched completely, including when the API page cap
is lower than the requested 500 rows. Requests have a shared 10-second timeout.

Missing/invalid settings return HTTP 503. Upstream errors, timeouts, and invalid
data return HTTP 502 with `{source: 'supabase', code, error}`. Upstream response
bodies and secrets are never forwarded or logged. No sample fallback is used.

The website now reads players and matches from the two local GET APIs on every
page reload or "DB 새로 조회" action. It does not load sample-data.json or the
legacy browser player/match store. Match registration is enabled only when both
development settings and local request protections pass. Player registration
remains disabled. Only demo analysis reports use a separate browser-local store.
An empty database returns empty arrays, not sample records.

Local tests (no credentials or database access required):

```powershell
node --test preview.test.mjs core.test.cjs
```
