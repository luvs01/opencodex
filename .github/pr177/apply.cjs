// Fork-only preparation tool. Not part of the upstream change set.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(process.argv[2]);
const payload = path.resolve(process.argv[3]);
const BASE = '3070d64d8822c6d8c62989665f82ab665e4d164c';
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== BASE) throw new Error('Refusing an unexpected baseline');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, text) => {
  const file = path.join(root, p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const replaceOnce = (text, from, to) => {
  if (text.split(from).length !== 2) throw new Error('Expected one exact replacement anchor: ' + from.slice(0, 80));
  return text.replace(from, to);
};
const checkBlob = (p, expected) => {
  const bytes = fs.readFileSync(path.join(root, p));
  const hash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (hash !== expected) throw new Error('Unreviewed source at ' + p);
};
checkBlob('src/server/relay.ts', 'f480ace68a65747aad3fc237c3735c3017dee360');
checkBlob('src/server/responses/passthrough-delivery.ts', '79e6ca3d468ce6d9af3e2755172c7a553cff767b');

for (const p of [
  'src/server/response-log-body.ts',
  'src/server/inspection-tee.ts',
  'tests/server/response-log-inspection.test.ts',
  'tests/usage/request-log-nonstream.test.ts',
]) {
  if (fs.existsSync(path.join(root, p))) throw new Error('Refusing to overwrite ' + p);
  write(p, fs.readFileSync(path.join(payload, p), 'utf8'));
}

let relay = read('src/server/relay.ts');
relay = replaceOnce(relay,
  'import { replaceSseDataPayload } from "./sse-payload-rewrite";',
  'import { replaceSseDataPayload } from "./sse-payload-rewrite";\nimport { createBoundedResponseLogBody } from "./response-log-body";');
const start = relay.indexOf('      const finalizeJsonLog = async () => {');
const end = relay.indexOf('      return new Response(body, {', start);
if (start < 0 || end < start) throw new Error('Missing non-stream response wrapper');
relay = relay.slice(0, start) + `      const body = createBoundedResponseLogBody(response.body, {
        json: contentType.includes("application/json"),
        inspect: text => inspectResponseLogJson(logCtx, text),
        finalize: reason => {
          // Preserve wire status; request history follows the adjacent SSE
          // convention for a client cancellation or upstream read failure.
          const status = reason === "cancel" ? 499 : reason === "read_error" ? 502 : response.status;
          addFinalRequestLog(requestId, start, logCtx, status, {
            closeReason: reason === "cancel" ? "client_cancel" : "non_stream",
          }, addLog);
        },
      });
` + relay.slice(end);
relay = replaceOnce(relay,
  '        const { done, value } = await reader.read();\n        if (clientGoneSignal?.aborted) markClientGone();',
  '        const { done, value } = await reader.read();\n        // Hard cancellation settles a pending read as EOF. Do not flush a\n        // partial terminal after the owner already finalized cancellation.\n        if (cancelled) break;\n        if (clientGoneSignal?.aborted) markClientGone();');
write('src/server/relay.ts', relay);

let delivery = read('src/server/responses/passthrough-delivery.ts');
delivery = replaceOnce(delivery,
  'import { isUsageDebugEnabled } from "../../usage/debug";',
  'import { isUsageDebugEnabled } from "../../usage/debug";\nimport { teeWithBoundedInspection } from "../inspection-tee";');
delivery = replaceOnce(delivery,
  '      const [nativeBody, inspectBody] = passthroughSseBody.tee();\n', '');
delivery = replaceOnce(delivery,
  '      const clientGone = new AbortController();\n',
  '      const clientGone = new AbortController();\n      const clientGoneSignal = options.abortSignal\n        ? AbortSignal.any([clientGone.signal, options.abortSignal])\n        : clientGone.signal;\n      // Pace against raw bytes before rewrites, without detaching terminal ownership.\n      const [nativeBody, inspectBody] = teeWithBoundedInspection(passthroughSseBody, { clientGoneSignal });\n');
delivery = replaceOnce(delivery,
  '        clientGoneSignal: options.abortSignal\n          ? AbortSignal.any([clientGone.signal, options.abortSignal])\n          : clientGone.signal,',
  '        clientGoneSignal,');
write('src/server/responses/passthrough-delivery.ts', delivery);

const registrations = {
  'response-log-inspection.test.ts': 'server',
  'request-log-nonstream.test.ts': 'usage',
};
for (const [p, nested] of [
  ['scripts/test-layout/layout.json', true],
  ['tests/fixtures/test-layout-expected.json', false],
]) {
  const value = JSON.parse(read(p));
  const entries = nested ? value.explicit : value;
  if (!entries || Array.isArray(entries) || typeof entries !== 'object') throw new Error('Unexpected test layout');
  for (const [name, domain] of Object.entries(registrations)) {
    if (entries[name] !== undefined) throw new Error('Duplicate test registration: ' + name);
    entries[name] = domain;
  }
  write(p, JSON.stringify(value, null, 2) + '\n');
}

const canonical = 'structure/transports/byte-accounting.md';
write(canonical, read(canonical) + `
## Response-log inspection

\`src/server/response-log-body.ts\` forwards raw response chunks on downstream demand.
Diagnostic retention is limited to 32 MiB for JSON and an 8 KiB prefix for other
HTTP error bodies. Fixed 64 KiB blocks also bound per-chunk bookkeeping. These
are retained-source-byte limits, not peak heap or response-delivery limits:
joining, decoding and parsing a bounded JSON body can temporarily use more memory.
An oversized JSON candidate is discarded immediately; partial JSON on read error
or cancellation never replaces model or usage metadata. Existing trusted metadata
is preserved. The existing parser and redaction path inspect complete admitted
JSON and bounded non-JSON error prefixes. EOF, read error and cancellation finalize
once; history records the original status, 502 or 499 respectively, without
rewriting the response status or bytes already sent to the client.

\`src/server/inspection-tee.ts\` paces the native SSE inspection branch against raw
client consumption before rewrites. Its 32 MiB read-ahead allowance is not a total
turn limit: long streams retain terminal, usage and continuation observation.
The allowance can be exceeded by one source chunk plus native tee prefetch; it is
not an RSS limit or a producer-side bound for push transports. Existing eager-path
selection, WebSocket bounds and SSE frame/output-item limits are unchanged.
Client departure releases pacing to the existing 15-second/32-MiB bounded drain.
One tee branch's cancellation is never awaited by the wrapper, because that
promise may depend on its sibling. A hard owner abort discards pending candidates
rather than flushing them as successful terminals; genuine EOF/read-error tail
handling remains distinct.

\`tests/server/response-log-inspection.test.ts\` covers the real inspector/relay
composition, including a turn beyond 32 MiB, late usage/output, slow readers,
cancellation and read-error races. \`tests/usage/request-log-nonstream.test.ts\`
binds the bounded non-stream wrapper to request-log status and metadata behavior.
`);
const manifest = JSON.parse(read('structure/manifest.json'));
for (const doc of manifest.docs) {
  if (!doc.documents.some(area => ['src/server/', 'scripts/', 'docs-site/'].includes(area))) continue;
  const p = 'structure/' + doc.path;
  if (p === canonical) continue;
  const link = path.posix.relative(path.posix.dirname(p), canonical) + '#response-log-inspection';
  write(p, read(p).trimEnd() + `\n\nShared response-log retention and native SSE inspection pacing follow the [bounded inspection contract](${link}); other subsystem behavior remains unchanged.\n`);
}

write('docs-site/src/content/docs/guides/response-inspection.md', `---
title: Response inspection and large responses
description: How bounded diagnostic retention and streaming inspection interact with response delivery.
---

OpenCodex keeps response diagnostics bounded without making the logging limit a
limit on the bytes delivered to your client. Other provider, request and transport
limits still apply independently.

## JSON and ordinary error responses

JSON inspection retains at most 32 MiB of source bytes. If the body exceeds that
allowance, logging drops its retained copy and continues forwarding the original
response. It does not parse a truncated prefix as authoritative usage or model
metadata. Usage already supplied by another trusted path is preserved; missing
usage is not replaced with an invented zero. Ordinary non-JSON error diagnostics
retain only the first 8 KiB and pass through the existing redaction logic.

The client receives chunks as it reads them rather than waiting for diagnostic
inspection of the whole body. A read failure is recorded as 502 and cancellation
as 499 in request history; these diagnostic outcomes do not rewrite HTTP headers
that have already been sent. Logging is finalized once.

## Streaming responses

Native SSE inspection pauses when it runs too far ahead of client consumption.
The allowance is 32 MiB plus source-chunk/native-prefetch overhead, not a total
response-size limit or a cap on all process memory. A longer response is still
inspected through its actual completion event, including terminal usage and
continuation state.

After the client disconnects, the existing bounded drain can still observe a late
completion for up to 15 seconds or 32 MiB of additional inspection. A forced
shutdown is different: it discards uncompleted candidates rather than recording
them as a completed response. Existing transport selection and WebSocket memory
bounds are unchanged. No new configuration setting is required.
`);
console.log('Prepared reviewed PR177 changes against ' + BASE);
console.log(git('diff', '--stat'));
