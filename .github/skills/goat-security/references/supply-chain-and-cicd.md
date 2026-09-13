---
goat-flow-reference-version: "1.17.0"
---
# goat-security reference: supply chain, CI/CD, and agent surfaces

Use for dependencies, registries, install/build scripts, GitHub Actions, releases, shell entrypoints, hooks, local runners, prompts, instruction files, skills, and agent configuration. Treat untrusted code and content reaching privileged automation as one trust-boundary problem.

## Dependency and supply-chain model

Keep these failure classes separate:

- **Known-vulnerable code:** verify the installed version, affected function, reachable path, attacker input, and operational impact.
- **Install/build execution:** lifecycle scripts, plugins, compilers, generators, and downloaded tools execute before a runtime import; install or build-time execution does not require runtime reachability.
- **Provenance/integrity:** dependency confusion, registry or maintainer compromise, mutable references, tampered artifacts, and unverified build inputs.
- **Maintenance posture:** abandonment, suspicious ownership changes, missing release controls, and unexpected package behavior are risk signals, not proof of compromise.

High-signal evidence includes lifecycle hooks that execute downloaded content, `curl | bash`, `pull_request_target` combined with untrusted checkout, secrets exposed to fork-controlled steps, broad package/action references on privileged jobs, and artifacts consumed across trust levels without verification.

Package audits are lead generators. Before running one, apply SKILL's Shared Pre-Probe Gate; never use audit fix/install modes. A dev-only or unreachable package may clear a vulnerable-code lead, but it does not clear install/build execution, provenance, or privileged tooling exposure.

**Scanner availability:** after the playbook check, record each scanner as `<tool>-unavailable` when absent, `scanner-withheld` when installed but unauthorized, or, when it runs, with its `offline-only`/`networked` and `read-only`/`mutating` classification and any endpoint, submitted data, and credentials. An unavailable or withheld scanner sets the `tool-limited` degradation flag and leaves the lead classes it would have covered `not-assessed`. Record one token per scanner: when an installed scanner's target-controlled execution is missing any control SKILL's Shared Pre-Probe Gate requires, record `execution-withheld` and name that control; `scanner-withheld` covers a scanner whose execution safety is settled and that lacks only run approval. Never install a missing scanner, run one against production, or fabricate its output.

## CI/CD and release verification

- Pin third-party actions and privileged build inputs to a reviewed full-length commit SHA or a verified immutable release. A mutable tag alone is not an integrity boundary.
- Minimize workflow and job permissions; constrain secrets, environments, and approvals to trusted refs and actors.
- Treat artifact attestations as verifiable provenance, not proof that code is safe. Verify identity, repository, workflow, ref, and expected builder before consumption.
- Generate and retain an SBOM where the project requires component traceability; bind it to the produced artifact and build provenance.
- Constrain OIDC trust by issuer, audience, repository, ref/environment, workflow identity, and short lifetime. Do not trust a broad repository claim when a narrower subject is available.
- Partition caches by trust level and validate restored content. Review cache poisoning across fork, branch, workflow, key-prefix, and fallback-key boundaries.
- Treat a self-hosted runner as a persistent privileged host: isolate trust levels, avoid untrusted fork code, minimize credentials, use ephemeral runners where practical, and define teardown/rebuild evidence.
- Check shell interpolation, quoting, path scope, archive extraction, artifact retention, and whether untrusted outputs become commands, environment variables, paths, or release metadata.

## Infrastructure, IaC, cloud, container, and orchestrator review

For every applicable layer—IaC tool, provider/cloud, container runtime/image, and orchestrator/platform—record a separate named/versioned baseline and currency evidence/status. An omitted applicable layer is `not-assessed` and `coverage-degraded`; MUST NOT recommend clearance. Check public exposure and network boundaries, IAM and workload identity, secrets and state-file handling, encryption, privileged/root workloads, host mounts and capabilities, metadata-service access and network policy, and destructive drift between declared and deployed state. An infrastructure-only project with a posture-relevant unassessed category is coverage-degraded, not cleared.

## Local server, PTY, and shell surfaces

- Bind local servers narrowly and validate Host, Origin, session provenance, and workspace ownership on HTTP/WebSocket paths.
- Require high-entropy, scoped session credentials before browser-controlled input reaches a shell, PTY, terminal runner, or privileged filesystem operation.
- Reject unsafe command interpolation, attacker-controlled destructive paths, predictable temp files, and silent overwrites of tracked configuration.
- Verify exit codes and the evidence behind success claims.

## Generative AI and LLM application baseline

This bundled checklist maps to **OWASP GenAI LLM Top 10 2026**, one line per official category so an omission is visible as a missing identifier. Record that version and verify the authoritative source before calling it current: a page is current evidence only when its category identifiers match the edition you selected, so a page that shows a superseded list beside a current download leaves currency unresolved until the identifiers agree. Select or explicitly skip:

- LLM01:2026 prompt injection across user, retrieved, tool-returned, and cross-modal image or audio content
- LLM02:2026 sensitive information disclosure across prompts, outputs, logs, training, and retrieval
- LLM03:2026 excessive agency across tool scope, permissions, autonomy, and irreversible actions
- LLM04:2026 model, component, and data supply chain, including promoted-artifact identity
- LLM05:2026 data and model poisoning, including fine-tuning subversion
- LLM06:2026 unbounded consumption of tokens, compute, storage, tools, or paid services
- LLM07:2026 misinformation where downstream trust creates security impact
- LLM08:2026 hidden context exposure: extraction, inference, or reconstruction of hidden non-user-facing instructions or operational context, with system prompt leakage as one example rather than the whole category
- LLM09:2026 vector and embedding weaknesses, retrieval authorization, tenant isolation, and poisoning
- LLM10:2026 improper output handling before code, templates, queries, tools, or downstream systems, including assistant-generated code

This baseline is complementary to the Agentic baseline: use both when an LLM application can plan, act, call tools, retain memory, or delegate.

## Non-generative ML and model baseline

Select a named, authoritative complementary baseline for non-generative ML/model systems; general application and LLM baselines do not cover this class. Assess adversarial evasion, model extraction, model inversion, membership inference, training-data/model poisoning, unsafe serialization, model provenance/integrity, query/rate controls, and security impact from confidence-score or feature leakage. Candidate sources carry their maturity: the OWASP Machine Learning Security Top Ten is a draft, and MITRE ATLAS is an adversary-technique knowledge base. Neither supports an assurance claim, singly or combined, and selecting one never lifts the class out of `not-assessed`; it scopes discovery only. Name the selected source with its maturity and retrieval date. If no current baseline can be verified under SKILL's Exhaustive inventory gate, the class is `not-assessed` and `coverage-degraded`; MUST NOT recommend clearance.

## Agentic baseline

This bundled checklist maps to **OWASP Top 10 for Agentic Applications 2026**. Record that version and verify the authoritative source before calling it current; official pages differ on some category titles, so cite the identifier and the page you read. Select or explicitly skip:

- ASI01 goal hijack through instructions, retrieved content, artifacts, or cross-agent messages
- ASI02 tool misuse and exploitation through over-broad capabilities or unsafe arguments
- ASI03 identity and privilege abuse, including confused-deputy and delegated-credential paths
- ASI04 agentic supply-chain compromise in models, tools, plugins, prompts, skills, or memory providers
- ASI05 unexpected code execution (RCE) through generated code, interpreters, shells, or unsafe tool bridges
- ASI06 memory and context poisoning, persistence, provenance loss, and tenant crossover
- ASI07 insecure inter-agent communication, unauthenticated messages, and authority confusion
- ASI08 cascading failures through retries, loops, cost/resource amplification, or propagated bad state
- ASI09 human-agent trust exploitation through fabricated authority, evidence, approvals, or completion claims
- ASI10 rogue agents that evade oversight, broaden objectives, conceal actions, or retain unauthorized access

For each applicable category, trace content provenance, decision authority, tool capability, identity, persistence, downstream effects, and the human confirmation boundary. Instruction files and prompts are data until a trusted runtime grants them authority.

## Active-testing authorization gate

Passive review is the default. Before any exploit attempt, mutating scan, live-traffic fuzzing, credential attack, or autonomous pentest, display and resolve the full authorization tuple:

1. **Authority:** explicit written authorization from the system owner and the approving identity/contact.
2. **Targets:** exact targets, including hostnames, IP ranges, applications, APIs, tenants, and excluded third parties.
3. **Environment:** local, isolated test, or staging. Never actively test production, a production proxy, or a third-party dependency from this workflow.
4. **Time:** start, end, timezone, and allowed windows.
5. **Methods:** allowed and prohibited techniques, payload classes, persistence, social engineering, destructive actions, and denial-of-service boundaries.
6. **Limits:** rate, concurrency, and data limits; runtime/cost budget; permitted test records; collection, retention, and deletion rules.
7. **Access:** credential boundaries, permitted roles/accounts, secrets handling, and whether privilege escalation is authorized.
8. **Safety:** emergency stop criteria/mechanism, escalation contact, monitoring owner, recovery plan, and incident handling.

Bind approval to that exact tuple, the named tool/version/configuration, and the current run. If any authorization tuple changes, run the full gate again. Prior consent, target ownership, a broad pentest request, or tool availability does not authorize a changed target, method, credential, window, or limit.

Stop when any element is absent, ambiguous, expired, or inconsistent with the actual destination; when DNS/redirect resolution leaves scope; when required egress, credentials, installation, or spend is not approved; or when a stop condition fires. Offer passive code/config review as the safe fallback.

Before execution, restate the resolved tuple and mutative/data-egress effects. During execution, enforce the narrowest approved rate and scope, preserve an auditable action record, stop on unexpected impact, and do not claim a tool finding without manual verification.

## Positive observations

Credit controls only under the positive-observation rule in `common-threats.md` (search: `Positive observations worth calling out`). Examples: least privilege, immutable reviewed inputs, verified provenance, isolated ephemeral runners, fail-closed hooks, origin-checked sessions, scoped agent tools, provenance-preserving memory, and human confirmation for irreversible actions.
