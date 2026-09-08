# MaintainX proxy (O51)

The app is a static bundle on GitHub Pages, so it cannot hold a MaintainX
bearer token. This proxy holds it and exposes four actions:
`mx-resolve`, `mx-receive`, `mx-onhand`, `mx-issue`, plus `GET /health` and
`GET /warm`.

## Writes are off by default

`MX_ALLOW_WRITES` must be the string `true` before any POST or PATCH reaches
MaintainX. With it unset, a receive still does its live GETs and returns:

- `dryRun: true`
- `wouldSend`: the exact request it withheld
- `before`: current state in MaintainX, unchanged

That is deliberately reviewable rather than a stub, so the whole path can be
exercised against the live org without touching it.

## Env

| Var | Meaning |
|---|---|
| `MX_KEY` | MaintainX bearer token. Required. Never commit it. |
| `MX_ALLOW_WRITES` | `true` to actually write. Anything else withholds. |
| `MX_ALLOCATION_FIELDS_READY` | `true` once the `Facility Handle` and `PO Number` custom fields exist in MaintainX. Until then allocation is written to `externalId` as `HANDLE\|PO` and every response says so. |
| `MX_INDEX_TTL_MS` | Scan-index freshness, default 300000. |
| `PORT` | Local/container port, default 8787. |

## Run it locally

```bash
MX_KEY=... node server/local.mjs
curl localhost:8787/warm
curl -X POST localhost:8787/ -d '{"action":"mx-resolve","code":"OU5MD7IS6LE0"}'
```

## Why it is not a Power Automate flow

The existing `PUMA Inventory Intake (O24)` flow writes to SharePoint with the
`Send an HTTP request to SharePoint` action, which is a standard connector.
Calling `api.getmaintainx.com` needs Power Automate's generic **HTTP action,
which is a premium connector**. Rather than make O51 depend on premium
licensing nobody has confirmed, the MaintainX path is this proxy. The
SharePoint flow is untouched and still serves En route, Log a package and
Packages.

## It needs a warm process, not a stateless function

MaintainX has no server-side barcode or serial filter: `/v1/parts` and
`/v1/assets` accept only `limit` and `cursor`. So resolving one scan means
having every record in memory. A cold index build is ~48 API calls and
measured **5.9 seconds** for 4,544 parts, 4,695 assets and 142 locations.

That rules out a per-request stateless function unless you want six seconds
on every scan. Host it as a long-lived process and call `/warm` at start.

## Deploy options, cheapest first

1. **Azure Container App.** MEW already runs one, so the pattern and the
   pipeline exist. Set the env vars as secrets, expose 8787, ingress external.
2. **Azure App Service / any container host.** `node server/local.mjs` is the
   entry point; nothing else is needed.
3. **Cloudflare Worker.** `handler.mjs` exports a `handle(request, env)` that
   fits a Worker's `fetch` with a three-line wrapper, but a Worker is
   stateless, so read the section above first.

After deploying, put the URL in the app's Settings panel (stored per device in
`localStorage`) or bake it into the build as `VITE_MX_URL`.

## Regenerating the facility map

`src/facilities.json` is the QuickBase-to-MaintainX join that allocation
depends on. It is committed so a build needs neither system.

```bash
./scripts/export-qb-facilities.sh > qb-facilities.json
MAINTAINX_API_KEY=... node scripts/build-facilities.mjs qb-facilities.json > src/facilities.json
```
