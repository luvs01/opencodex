# Kiro Provider

Native steering follows [the shared WebSocket contract](../transports/streaming-health.md#experimental-native-mid-turn-steering); this surface's defaults remain unchanged.

The configuration-only [plaintext V2 contract](../subagents.md#plaintext-v2-agent-messages)
is scoped to canonical ChatGPT Responses forwarding; other source-area behavior described here is unchanged.

The shared hosted-tool policy has no Codex Spark-specific branch. Kiro continues to use its
provider capabilities below; see [Responses compatibility](../transports/responses.md#responses-httpsse).

## Kiro client parallel-tool hint

Kiro's wire remains serialized even when an OpenAI Responses client sends
`parallel_tool_calls: true`. That request field is permissive: it allows parallel calls but does not
require the routed transport to expose a matching flag. The Kiro catalog therefore continues to
advertise `supports_parallel_tool_calls: false`, and the adapter emits no parallel-control field,
while accepting the client hint and translating the ordinary tool catalog normally.

> Decision record: [ADR-0060](../decisions/ADR-0060-kiro-client-parallel-tool-hint.md)

Kiro's own `kiroToolName` rewrite in `src/adapters/kiro-wire.ts` is CodeWhisperer-only and
reserves the private completion tool. Meta Muse 64-character MCP aliases live in
`src/responses/muse-tool-name-alias.ts` and must not import that Kiro helper.

## Kiro Responses text controls

Kiro shares the Responses freeform restoration boundary in
`src/responses/apply-patch-envelope.ts`: contractual `input` wrappers are unwrapped, while alternate
field and outer-fence recovery is limited to unambiguous bare `exec` and `apply_patch` bodies.

Kiro refuses structured output and tolerates every other Responses `text` member. `text.format`
of type `json_schema` or `json_object` is a contract the CodeWhisperer wire cannot honour, so the
adapter rejects it rather than returning prose to a caller expecting JSON. `text.verbosity` and
`text.format: {"type":"text"}` are preferences, not contracts; they are accepted and dropped,
because `buildKiroPayload` composes `conversationState` from parsed fields and never forwards the
raw body.

> Decision record: [ADR-0061](../decisions/ADR-0061-kiro-responses-text-controls.md)

## Kiro reasoning round-trip (`signature`)

Kiro never returns plaintext reasoning for its **GPT-5.6 family** (`gpt-5.6-sol`, `-terra`,
`-luna`): `reasoningContentEvent` carries a KMS-encrypted blob rather than readable reasoning. It
arrives on `signature`, holding the `.KTR~~…` value verbatim, which is what every capture of those
models sent. The event's `text` field is not absent — every captured GPT-5.6 frame left a literal
`"..."` placeholder there, which the adapter forwards as a `reasoning_raw_delta` — but it never
carries model reasoning, so `signature` is the only field worth replaying
(`tests/providers/kiro/kiro-reasoning-roundtrip.test.ts`).
Their `additionalModelRequestFieldsSchema` (`ListAvailableModels`) accepts only
`reasoning.effort` with `additionalProperties: false` — there is no display/summary opt-in, so this
is the only reasoning these models can return, and all three select that native field
(`KIRO_NATIVE_EFFORT_FIELDS` in `src/adapters/kiro/reasoning.ts`). Kiro's own CLI replays the blob
on the matching `assistantResponseMessage.reasoningContent` to preserve model reasoning across
turns; dropping it makes every turn restart without the previous turn's reasoning. Verified on
kiro-cli 2.14.1 and 2.16.0, all three models.

Native effort admission is narrower than model eligibility: luna and terra send only
`low`, `medium`, `high`, and `max` on the native field. Their `xhigh` requests retain the
previous emulated thinking tags because that native rung is unverified. A future shared
effort rung does not expand this allowlist. Sol and Opus keep their existing native ladder.

The two members of `reasoningContent` are not interchangeable. The wire validates the shape of the
member rather than its content, and the signature is not base64 — its alphabet contains `.` and
`~` — so a blob replayed as `redactedContent` is rejected with `REQUEST_BODY_INVALID`
("Improperly formed request"). `signature` therefore takes the verbatim value and
`redactedContent` remains the home for the base64 shape another model may send. Which field a blob
arrived on is carried by the blob itself, one opaque string with a `signature:` tag, rather than by
a second value that could drift from it; provider data cannot forge the tag, because base64 has no
colon.

The Claude 4.6+/5 entries advertise a different, richer contract (`thinking.type` adaptive/disabled,
`thinking.display` summarized/omitted, `output_config.effort`, `max_tokens`) and are not covered by
that measurement; older Claude, deepseek, minimax, glm, and qwen entries advertise no additional
fields at all. The handling below keys off the wire field, not the model id, so any model that
sends either member round-trips.

- The tagged blob rides the existing `ocxr1:` envelope as `krc`
  (`src/responses/reasoning-envelope.ts`) on an envelope-only reasoning item — `summary: []`, no
  text deltas — so it stays invisible in the Codex app while round-tripping, exactly like the
  hidden-thinking path.
- **Pairing is backwards.** Kiro emits `reasoningContentEvent` at the END of an assistant turn,
  after content AND tool calls. A `krc`-only item therefore belongs to the turn that already
  closed, so the parser attaches it to the PRECEDING assistant message rather than folding it into
  the following turn like ordinary reasoning (`src/responses/parser.ts`). With no assistant turn to
  own it, the blob is dropped rather than mis-paired.
- The blob lives on `OcxAssistantMessage.kiroRedactedReasoning`, not on a thinking content part, so
  no other adapter replays provider-private state if the conversation switches providers.

Kiro reports context pressure in its own `contextUsageEvent`, which is the authoritative source. On
every capture taken (2.14.1 and 2.16.0) `metadataEvent` carried only `stopReason` — which is why
reading the percentage from `metadataEvent` alone never saw a value — but the parser still accepts a
finite `contextUsagePercentage` (and a `tokenUsage` block) there as a fallback, so a value parsed
from `metadataEvent` is legitimate rather than impossible. Both feed the same field, and any
positive value overwrites an earlier one.

Spend arrives in `meteringEvent` as **credits, not tokens**. No captured response carried
`tokenUsage` on any event, which is why Kiro usage stays estimated; `meteringEvent` is currently
ignored because a credit is not a token count.
## Delivered final-answer termination scope

A delivered `final_answer` may close a Kiro turn only for the exact request that emitted it.
`src/responses/turn-termination.ts` keeps a process-wide map of delivered-answer fingerprints
keyed by a bound scope rather than by the parsed request's fields. The scope is bound in
`src/server/responses/request-transport.ts` after the final adapter is resolved, and only when
that adapter is `kiro`: the digest covers the conversation lane (`sessionSpecificLaneIdFromRequest`,
or the normalized Cursor conversation id when no lane headers exist), the admission identity, the
routed provider and model, and the serving credential. The composite is hashed before binding, so
no caller, account, key or route identifier is retained, and a request with no conversation
identity binds no scope at all. The lane must name a child: a request carrying only
`x-codex-parent-thread-id` gets the coalescing group as its lane, which every sibling under that
parent shares, so a parent-only request binds no scope rather than collapsing the group into one
conversation.

Conversation, admission, and route are captured eagerly — they belong to the admitted request —
but the serving credential resolves lazily at check/record time. Kiro key-pool and OAuth failover
can swap the physical transport after the bind, and every rotation site rewrites
`route.provider`, so a deferred resolver lands the record under the credential that actually
served instead of the one that failed. For key-authenticated routes the credential element is
`credentialIdentity` — the digest of the resolved wire credential, not the configured
`env:`/`keychain:` reference, so a rotation behind a stable expression terminates the old
identity's scope; an OAuth snapshot account id wins when one is bound, and the Codex auth
context is the last resort — different keys therefore never share a scope.

Because the credential resolves lazily, the check must read the same selection the upcoming send
would use, and selection is mutable while a request waits. `prepareAdapterExchange` therefore
runs the dispatch binding's staleness check (`selectionIsCurrent`, `refreshDispatchAdapter`) before
evaluating `localTerminal`, so a record a since-replaced credential made cannot suppress work the
send path would have moved onto the live one. A failed refresh leaves the route stale, so the
terminal is skipped entirely and the ordinary send path surfaces the credential error instead
of a stale-credential hit masquerading as success.

A bare log-conversation digest is too wide here: it deliberately coalesces a parent's parallel
subagents, and a scope that coarse would let one child's delivered answer suppress a sibling's
unfinished work. Nothing in `request-prepare.ts` binds the scope — including encrypted-task
recovery, whose reparsed body reaches the same transport binding — so the transport write is the
only write of the scope.

`rememberDeliveredFinalAnswer` records the trailing `final_answer` text fingerprint at delivery
(`adapter-delivery.ts`, `run-turn-execution.ts`, `sidecar-execution.ts`), holding it for one hour
across at most 1,024 scopes. `hasTrailingDeliveredFinalAnswer` in
`src/adapters/kiro/conversation.ts` matches a later turn only while its trailing assistant text is
still the recorded answer, so `src/adapters/kiro/payload.ts` withholds the completion tool and
emits the neutral acknowledgement instead of a continuation prompt
(`tests/server/server-kiro-completion-e2e.test.ts`).

## Remote image references

Kiro's wire inlines base64 bytes only, so a remote `https` image reference cannot be
sent. It used to be dropped with neither bytes nor any marker, so the payload and the
evidence that an attachment existed both disappeared.

`countKiroUninlinableImages` reports how many parts `parseDataUrlImage` could not
inline, and the payload builder appends a bounded marker to that turn's text. The
marker is appended before `rawGroupText` is computed, because adjacency grouping
rebuilds a turn's content from its collected texts and would otherwise discard it.

No fetch is introduced: resolving the reference server-side would add an outbound
request on a request path. The marker carries a count and no URL, because a remote
image URL can carry a signed token.

Translated audio/file admission follows the [final-adapter input contract](../adapters/registry.md#untranslated-input-media); native raw passthrough remains separate.
