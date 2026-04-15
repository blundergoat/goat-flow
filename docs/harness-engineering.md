# AI Harness Engineering - The Five Harness Concerns


## 1. Context



**Sources:**
- Every source agrees context quality matters
- OpenAI: "Give Codex a map, not a 1,000-page instruction manual"
- ETH Zurich study: LLM-generated agentfiles hurt performance; concise, human-written ones help
- Anthropic: progress file pattern for structured context handoff

---

## 2. Constraints


**Sources:**
- OpenAI Codex team: custom linters with error messages that include remediation instructions
- Birgitta Böckeler: computational feedforward controls - deterministic rules that steer the agent before it acts
- Han Heloir Yan (5-layer model): L1 Constraint as the skeleton - "the highest marginal return on a managed platform"

---

## 3. Verification



**Sources:**
- Mitchell Hashimoto: "anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again"
- OpenAI: structural tests and pre-commit hooks on every code generation output
- HumanLayer: back-pressure mechanisms - "your likelihood of success is strongly correlated with the agent's ability to verify its own work"
- Birgitta Böckeler: feedback sensors - computational and inferential checks that observe after the agent acts

---

## 4. Recovery



**Sources:**
- Anthropic: session durability and checkpoint-resume with external event log
- harness-engineering.ai (Dr. Sarah Chen): lifecycle management - startup, health monitoring, crash recovery
- LangChain: LoopDetectionMiddleware for detecting doom loops

---

## 5. Feedback Loop


**Sources:**
- Mitchell Hashimoto: the core principle - "never make that mistake again"
- OpenAI: "garbage collection" agents that scan for stale patterns and drift
- Birgitta Böckeler: the steering loop - iterating on the harness whenever issues recur

---

## Further reading

The harness engineering field is emerging. These are the primary sources behind the 5-concern model:

- Mitchell Hashimoto, "My AI Adoption Journey" (Feb 2026) - coined "harness engineering," established the core principle
- OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (Feb 2026) - most detailed case study of building a fully agent-generated product
- Birgitta Böckeler, "Harness Engineering" on martinfowler.com (Apr 2026) - feedforward/feedback taxonomy, harnessability concept
- Vivek Trivedy, "The Anatomy of an Agent Harness" on LangChain Blog (Mar 2026) - derived harness components from what models can't do natively
- Kyle, "Skill Issue: Harness Engineering for Coding Agents" on HumanLayer Blog (Mar 2026) - most practical configuration guide
- Dr. Sarah Chen, "The Complete Guide to Agent Harness" on harness-engineering.ai (Mar 2026) - six core components overview
- Anthropic Engineering, "Scaling Managed Agents" (Apr 2026) - brain/hands decoupling, session durability
- Han Heloir Yan, "Anthropic Just Shipped Three of the Five Harness Layers" (Apr 2026) - 5-layer stack synthesis
