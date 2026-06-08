---
goat-flow-reference-version: "1.10.1"
---
# Observability

Use this when instrumenting application code with logs, metrics, span events, or trace context - i.e. adding signals that humans and dashboards will consume to answer *what happened, where, and why does it matter?*. Covers severity discipline, structured fields, naming, cardinality budget, sensitive-data rules, and the log-vs-metric-vs-span-event decision.

This playbook is OpenTelemetry-shaped - instrument kinds, severity numbers, semantic attribute names, and trace correlation rules all follow the OTel data model - but the discipline applies to any backend that ingests structured logs and metrics.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- Adding the first log or metric to a new service, worker, job, or endpoint.
- Reviewing a diff that adds or changes instrumentation.
- A postmortem reveals an instrumentation gap (logs missing context, metric explosion, severity confusion, broken trace correlation).
- A dashboard query, alert rule, or trace lookup keeps returning unusable signal.

No CLI check applies; correctness is verified at review time using the **Verification Gate** below, not by running a command.

## Intent

A coding agent adds instrumentation so a future operator can answer a concrete operational question without reopening the code: what happened, where, who or what was affected, and what action is expected. If a log, metric, or span event has no named consumer - dashboard, alert, runbook, incident query, or debugging workflow - do not add it.

## Boundary

| Concern | In this playbook | Lives elsewhere |
|---|---|---|
| What to emit, at what severity, with what fields | yes | - |
| Metric and attribute naming, units, cardinality | yes | - |
| Log vs metric vs span event vs trace decision | yes | - |
| Distributed trace context propagation (W3C traceparent, baggage) | brief - see "Trace correlation" | OTel SDK + transport docs |
| Sampling policy (head, tail, ratio) | no | OTel sampler docs + service-level decision |
| Backend storage, retention, alert routing | no | operations runbook |
| Profiling (CPU, memory, allocations) | no | profiler tooling for the runtime |

If the task is sampling or propagation, this playbook only frames the requirement; the implementation lives in the SDK docs.

## What a Good Log Looks Like

A good log answers *what happened, where, and why it matters* without forcing the reader to cross-reference another system. Three properties:

1. **Structured.** Variable data lives in attributes, not interpolated into the message. The message is a stable, searchable label; attributes carry the specifics.
2. **Contextual.** Carries enough identifying fields (entity IDs, operation, outcome) to be actionable on its own.
3. **Severity-honest.** Severity reflects who needs to act and how soon, not the author's emotional reaction.

### Structured fields, not interpolated strings

Bad (pseudocode):

```
logger.error("Failed to process payment for order " + orderId
             + " by user " + userId + ": " + exception.message)
```

Good (pseudocode):

```
logger.error("Payment processing failed", {
    order_id:        orderId,
    user_id:         userId,
    payment_gateway: gateway,
    amount_cents:    amountCents,
    currency:        currency,
    error:           exception.message,
    error_class:     typeName(exception),
})
```

The message stays constant across thousands of failures; the attributes vary. A single log query can now group every payment failure and break it down by gateway, currency, or error class.

Identifier fields such as `user_id`, `account_id`, and `order_id` mean opaque internal IDs. Do not use emails, names, external account numbers, or other personal identifiers as stand-ins for IDs unless the service's logging policy explicitly allows that storage path.

### Trace correlation

When a log is emitted inside an active span through an OTel-aware logger, the SDK attaches `trace_id`, `span_id`, and `trace_flags` to the log record. This is what makes a log reachable from a trace and a trace reachable from a log. Consequences:

- **Background jobs, queue consumers, and scheduled tasks must start their own root span** before emitting logs. Otherwise their logs have no trace context.
- **Long-running operations should emit logs inside the same span** rather than opening a fresh span per log. Many short, unrelated spans destroy the trace.
- **Plain stdout loggers that bypass the OTel logs pipeline** will not get correlation for free; they need explicit context injection at the call site.

### Enough context to act on the log alone

The reader is often an on-call engineer at 3am with no project context. Include identifiers for every relevant entity, the operation attempted, and the outcome. If reading the log requires opening another system to be useful, it is missing fields.

## Severity Contract

Severity is a filtering contract - downstream alert rules, dashboard panels, and on-call paging depend on it. Pick deliberately, not by feel.

| Level | OTel severity | Use for | Do not use for |
|---|---|---|---|
| `TRACE` | 1–4 | Step-by-step execution detail during local debugging | Anywhere outside an explicit debugging session |
| `DEBUG` | 5–8 | Internal state to aid diagnosis when a flag is on | Anything kept on by default in production |
| `INFO` | 9–12 | Normal operational events (startup, work-unit complete, config loaded) | Per-iteration loop output, hot-path traces |
| `WARN` | 13–16 | Unexpected-but-recovered; deprecated path used; fallback triggered; degraded mode entered | Routine success; user-caused validation failures |
| `ERROR` | 17–20 | A specific operation failed and warrants follow-up | Validation errors (downgrade to WARN); retries that succeeded |
| `FATAL` | 21–24 | Component failure affecting many operations; process exit imminent | A single failed request or job |

Two failure modes to watch for:

- **Over-logging at INFO and ERROR.** If a log always fires and always reads the same, it carries no information - remove it or move it to DEBUG behind a flag.
- **Under-logging at WARN.** Warnings are the early signal: degraded behaviour that hasn't yet failed. A service that emits only INFO and ERROR is blind to drift.

## Log vs Metric vs Span Event

> **Measure over time → metric. Diagnose a specific event → log. Annotate the trace timeline → span event.**

| Need | Signal | Why |
|---|---|---|
| Alert on a rate, drive autoscaling, build a dashboard panel | Metric | Aggregable across instances without scanning raw data |
| Investigate one specific failed request, job, or transaction | Log | Carries high-cardinality identifiers and a full attribute set |
| Mark a point of interest inside an active trace (`retry`, `cache_miss`, `fallback_used`) | Span event | Stays attached to the parent span; doesn't pollute the log stream |
| Capture a high-cardinality dimension (request ID, user ID, query hash) | Log or span attribute | Metric labels would explode the time-series count |
| Report a count, duration, size, or in-flight gauge | Metric | Backends store these in O(1) per unique label combination |

### The canonical pattern: emit both

Failures usually want **both** a log (the detail) and a metric (the rate):

```
logger.error("Payment processing failed", {
    order_id:        orderId,
    payment_gateway: gateway,
    error:           exception.message,
    error_class:     typeName(exception),
})

meter.counter("svc.payment.failures").add(1, {
    gateway: gateway,         // low cardinality: a handful of gateways
    reason:  classify(exception), // low cardinality: enumerated reasons
})
```

The log answers "why did *this* payment fail"; the counter answers "what is the failure rate by gateway right now". Neither replaces the other.

## Naming Conventions

### Metric names

Structure: `<namespace>.<domain>.<subject>.<measurement>`

Examples using the generic `svc.` namespace: `svc.payment.failures`, `svc.credit.usage.count`, `svc.api.requests.duration`, `svc.messenger.queue.depth`.

Rules:

- Lowercase, dot-separated. No hyphens, no internal underscores in path segments.
- The leading namespace marks metrics as application-owned. Use `svc.` as a generic default, or replace it with your service or org prefix (for example, `billing.` or `acme.`) so app-owned metrics do not collide with infrastructure or third-party signals.
- When working in a target project, check `.goat-flow/learning-loop/patterns/observability.md` if it exists; it may define project-specific namespaces, metric prefixes, or label conventions that override the generic examples here.
- **Encode variable dimensions as labels, not in the name.** `svc.payment.failures` with `gateway=stripe` - never `svc.payment.stripe.failures`.

### Instrument type and suffix

| Instrument | Suffix convention | Example |
|---|---|---|
| Counter (monotonic) | `.count` or an implied noun | `svc.payment.failures`, `svc.sms.sent.count` |
| Gauge (sampled value, callback-driven) | `.current` or descriptive noun | `svc.worker.threads.current`, `svc.queue.depth` |
| Histogram (distribution) | `.duration`, `.size`, `.latency` | `svc.api.request.duration`, `svc.upload.size` |
| UpDownCounter (signed delta) | descriptive noun | `svc.credit.balance`, `svc.active.sessions` |

### Units

Always declare the unit on the instrument (`ms`, `s`, `By`, `{requests}`, `{threads}`). Use UCUM where possible - it is what the OTel spec assumes. Unit mismatches between dashboards and instruments are the most common silent-misread bug; declare once, never assume.

### Attribute and label names

| Context | Convention | Example |
|---|---|---|
| Metric labels | `lowercase_snake_case`; finite, known cardinality | `gateway`, `outcome`, `reason`, `http_method` |
| Log attributes | `lowercase_snake_case`; prefer OTel semantic names | `exception.type`, `exception.message`, `http.response.status_code` |
| Custom resource or span attributes | `<namespace>.<name>` | `svc.region`, `svc.tenant_id`, `svc.cluster_id` |

Prefer OTel semantic conventions (`http.*`, `db.*`, `messaging.*`, `exception.*`, `service.*`) over ad-hoc names - backends, integrations, and other readers already know what they mean.

## Cardinality Budget

Every unique combination of metric label values creates a new time series. Cost (memory, ingest, query latency) scales with the cross product, not the sum.

Rules of thumb, in order:

1. **Hand-enumeration test.** If you cannot list the possible values for a label on a napkin, it is too high-cardinality for a metric label. Move it to a log or span attribute.
2. **Bounded enumerations only.** Acceptable labels look like `gateway` (3–10 values), `outcome` (`ok` / `failed` / `degraded`), `reason` (a known list), `http_method`, status class. Yes.
3. **Identifiers, free text, timestamps.** Request ID, user ID, full error message, query string, IP address - **never** as a metric label. These belong on the log record.
4. **When you need both granularities,** keep the metric label bounded (`error_type=gateway_timeout`) and put the specific identifier on the log (`error.message`, `request.id`). Connect them via `trace_id`.

Anti-pattern:

```
meter.counter("svc.payment.failures").add(1, {
    error: exception.message,    // Every distinct message creates a new time series
})
```

Fix:

```
meter.counter("svc.payment.failures").add(1, {
    error_type: classify(exception), // Bounded set: timeout, network, declined, ...
})
logger.error("Payment processing failed", {
    error:       exception.message,   // Full text lives here
    error_class: typeName(exception),
})
```

## Sensitive Data

Logs, traces, and metrics routinely become evidence in incidents, audits, and security reviews. Treat them as if they will be read by people outside the engineering team.

| Category | In logs / traces / metric labels? | Acceptable proxy |
|---|---|---|
| Secrets (passwords, tokens, API keys, signed cookies) | Never | `has_token: true`, `auth_method: "bearer"` |
| Government IDs (national ID, tax, health identifiers) | Never | Internal opaque ID |
| Payment instruments (PAN, CVV, full card) | Never | Last 4 digits, tokenised reference |
| PII fields without an approved storage path | No | Internal opaque ID |
| Free-text user input | No (likely to embed PII) | Length, hash, or a classified type field |
| Internal IDs (account, tenant, user, request) | Yes, within policy | - |
| Operation names, route shapes, status codes, durations | Yes | - |

Redact at the boundary where the value is first introduced. Trusting every downstream caller to redact is how leaks happen. Where you can, shape the field so only a sanitised value fits - `auth_method` accepting an enum, not a credential - so the type system enforces what discipline cannot.

## Anti-Patterns

- **Interpolated message strings.** Defeats grouping and indexing. Use structured attributes.
- **Severity by feeling.** A validation failure is not `ERROR`. A 4ms query is not `WARN`. Pick by who needs to act and how soon.
- **Metric label explosion.** See cardinality rules. The only safe label values are ones you can list from memory.
- **Logs without a span.** Background jobs and consumers that emit logs without first starting a root span produce untraceable records. Start a span at the work-unit boundary.
- **Logs as metrics.** Parsing logs at query time to derive a rate is fragile and expensive. Emit the counter from the application instead.
- **Hot-loop logging.** A log inside a 10k-iteration inner loop is a self-inflicted incident. Aggregate, then emit one summary at the end.
- **Double-logging the same error.** A wrapper logs the exception, the caller catches and re-logs it. The reader thinks two things happened. Catch and rethrow; log once at the boundary that has the context.
- **Conditional severity** (`logger.log(level=isInternalCaller ? WARN : ERROR, ...)`). Suggests severity is not load-bearing for either path. Pick one or split the events.
- **Renaming live metrics in place.** Dashboards, alerts, and saved queries reference the old name silently. Treat metric names as a public API: deprecate, dual-emit, then remove.
- **Adding a metric without naming the dashboard or alert it serves.** If you cannot name the consumer, you probably do not need the metric.

## Verification Gate

Before claiming new instrumentation is done, demonstrate it does what the reader expects.

1. **Logs:** find the new log in the backend by message and one expected attribute. If no backend is available, use a local OTel collector, test exporter, or captured structured-log output and label the proof as local-only. Confirm `trace_id` is present, or note explicitly that the call site has no active span and why.
2. **Metrics:** confirm the metric appears with the expected label set and unit in the backend or a local test exporter. Increment it in a test run and watch the value move. For histograms, verify bucket boundaries cover the expected range.
3. **Cardinality:** for each new label, list the possible values. If the list is open-ended, the design is wrong - fix before merging.
4. **Consumer named:** state the dashboard panel, alert rule, or runbook step this signal exists to serve. If you cannot name one, reconsider whether it should exist.
5. **Sensitive-data grep:** before merging, grep the diff for any field name in the sensitive-data table. Catching this in review beats catching it in a compliance audit.

Verification is the difference between "I added a log" and "I added a useful log". The first is trivial; only the second pays off.

## Related References

- `skill-preamble.md` - Proof Gate and OBSERVED / INFERRED tagging discipline applied when this playbook directs you to verify instrumentation.
- `skill-conventions.md` - footgun and lesson entry shapes for recording recurring instrumentation traps with file evidence.
- OTel Semantic Conventions (upstream spec) - authoritative names for `http.*`, `db.*`, `messaging.*`, `exception.*`, `service.*` attributes.
- OTel data model documentation - severity numbers, instrument kinds, log record shape, span event shape.
