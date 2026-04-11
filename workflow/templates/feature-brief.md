# Template: Feature Brief

> **What this is:** A template for writing feature briefs before involving AI agents.
> Copy this template into your project's `.goat-flow/tasks/` directory as
> `requirements-<feature-name>.md` and fill it in.
>
> The goat dispatcher walks through these same sections interactively when
> you ask it to plan a feature - you don't need to fill this out manually
> unless you prefer to write the brief yourself first.

Create a `requirements-<feature-name>.md` file using the template below. A brain dump is fine to start - the most important thing is capturing *why* this feature was requested and how it benefits users. For formal requirement tracking with REQ-IDs and acceptance tests, see `requirements-template.md`.

---

## Lean Hypothesis

> We believe that **[building X]** for **[these users]** will **[achieve this outcome]**.
> We will know we're right when we see **[this specific measurable signal]**.


## Problem & Outcome

- **Current state:** How does it work today, or what is the manual workaround?
- **Desired state:** What problem are we solving, and for whom?
- **Why now:** What business driver, pain, or event makes this urgent?
- **High-level success:** What does a win look like?



## Users & Use Cases


3–5 user stories in format: As a [user], I want to [action], so that [benefit].
Key workflows or scenarios.



## Scope & Constraints


What is included? What is explicitly out of scope? 
Hard constraints (performance, compliance, budget, deadlines, accessibility, internationalisation).



## Non-Functional Requirements

| Requirement | Target | Priority |
|---|---|---|
| Performance (p95 latency) | | Must/Should/Could |
| Security / auth changes | | |
| Data sensitivity (PII, health, financial) | | |
| Accessibility | | |
| Observability (what must we log to prove this is used?) | | |

*Expand during Mob Elaboration. Flag anything that affects architecture early.*


## System & Impact

Systems/services touched. Dependencies (APIs, data sources, infra). 
Related work or existing solutions. Stakeholders involved.


## Risks, Assumptions & Edge Cases


Key risks (with mitigation idea). Core assumptions (to validate). 
3–5 edge cases or failure modes. Ethical considerations if relevant.


## Success Criteria


2–3 measurable metrics. Testing strategy (how we validate it works). 
Performance expectations.


## Delivery Plan


Timeline & milestones. Deployment & rollback approach. 
Communication plan. Next steps. Approval & version history.



## Mini Example

**Lean Hypothesis:** We believe that adding a webhook notification system will reduce manual status-check calls by ~60%.

**Problem:** Users manually poll for status updates. Wastes their time and adds unnecessary API load.

**In scope:** Webhook registration endpoint, event dispatch on status change, retry on delivery failure.

**Anti-goals:** No webhook management UI, no batched delivery, no custom payload transforms.

**M1 Prove It Works:** Can we dispatch a webhook on status change and get a 200 response from the target URL under 2s?

**Acceptance is achieved when:** A registered webhook fires on every status change with retry on failure, no manual polling needed.

---

