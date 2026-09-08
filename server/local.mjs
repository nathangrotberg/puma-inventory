#!/usr/bin/env node
/**
 * Run the MaintainX proxy on a port for local testing and for a container host.
 *
 *   MX_KEY=... node server/local.mjs                 # read-only, writes withheld
 *   MX_KEY=... MX_ALLOW_WRITES=true node server/local.mjs
 *
 * Env:
 *   MX_KEY                        MaintainX bearer token (required)
 *   PORT                          default 8787
 *   MX_ALLOW_WRITES               'true' to actually send POST/PATCH
 *   MX_ALLOCATION_FIELDS_READY    'true' once the two custom fields exist
 *   MX_INDEX_TTL_MS               scan-index freshness, default 300000
 */
import { createServer } from 'node:http';
import { handle } from './handler.mjs';

const env = process.env;
if (!env.MX_KEY) {
  console.error('MX_KEY is not set. Refusing to start.');
  process.exit(2);
}
const port = Number(env.PORT || 8787);

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const out = await handle(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => {
  console.log(
    `MaintainX proxy on :${port}  writes=${String(env.MX_ALLOW_WRITES) === 'true' ? 'ENABLED' : 'withheld'}` +
      `  allocationFields=${String(env.MX_ALLOCATION_FIELDS_READY) === 'true' ? 'ready' : 'externalId fallback'}`,
  );
});
