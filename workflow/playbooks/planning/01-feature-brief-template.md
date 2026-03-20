# Template: Feature Brief

> **When to use:** At the start of any new feature or project, before involving AI agents. This is the human-only stage — the coding agent didn't attend your meetings, so this is how you tell it what matters.

Create a `requirements-<feature-name>.md` file using the template below. A brain dump is fine to start — the most important thing is capturing *why* this feature was requested and how it benefits users.

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



## Mini Example - Bulk Report Export

**Lean Hypothesis:** We believe that giving clinic admins a one-click bulk export will reduce manual data requests to the support team by ~60%.

**Problem:** Admins manually request CSV exports via support tickets. Takes 2–3 days per request.

**In scope:** CSV export, async job queue, email notification on completion.

**Anti-goals:** No Excel formatting, no scheduled/recurring exports, no per-row filtering UI.

**M1 Prove It Works:** Can we queue and process a 500-report export job under 30s without timing out?

**Acceptance is achieved when:** An admin can export 500 reports to CSV in under 30 seconds without a support ticket.

---

