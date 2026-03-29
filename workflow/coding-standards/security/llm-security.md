# LLM/AI Integration Security

Reference for generating `ai/instructions/security.md` in projects that integrate with language models or AI services.

## Prompt Injection

- **Direct injection**: user input passed to a model prompt without sanitization. Attacker crafts input that overrides system instructions.
- **Indirect injection**: injected instructions embedded in retrieved documents, database records, or web pages that the model reads during RAG.
- Treat all user-facing text that reaches a model prompt as untrusted input. Sanitize or structure it within clearly delimited boundaries.

```python
# DO — separate system instructions from user input with clear delimiters
messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": user_input},  # model sees this as user turn, not instructions
]

# DON'T — concatenate user input into the system prompt
prompt = f"You are a helpful assistant. The user says: {user_input}. Now respond."
```

- For RAG pipelines: sanitize retrieved documents before including in context. Strip or escape instruction-like patterns from external content.

## Output Validation

- Never trust model output as safe for direct use in code paths, database writes, or UI rendering.
- Validate model responses against expected schemas before acting on them (e.g., check that a generated SQL query only uses allowed tables/columns, or that a generated URL points to an allowed domain).
- If model output is rendered in HTML, apply the same XSS prevention (context-aware encoding) as any other user-generated content.

```python
# DO — validate model output before use
import json
response = model.generate(prompt)
try:
    parsed = json.loads(response)
    assert parsed["action"] in ALLOWED_ACTIONS
except (json.JSONDecodeError, KeyError, AssertionError):
    raise ValueError("Model returned invalid output")

# DON'T — execute model output directly
eval(model.generate("Write Python code to..."))
```

## System Prompt Confidentiality

- Do not expose system prompts in error messages, logs, or model responses.
- If the model is asked to reveal its instructions, it should decline — but do not rely solely on the model to enforce this. Filter responses server-side if system prompt leakage is a concern.
- Never include secrets (API keys, database credentials) in system prompts.

## PHI/PII in Model Context

- Apply minimum-necessary disclosure: send only the data the model needs, not full records.
- Strip or redact sensitive fields before passing context to the model.
- Model responses may reproduce sensitive data from the context window — validate and redact before storing or displaying.

## Token Limit and Cost Controls

- Set maximum input token limits to prevent crafted inputs that exhaust context budgets.
- Set maximum output token limits to prevent runaway generation costs.
- Rate-limit model API calls per user and per session.
- Monitor for patterns that trigger excessive tool calls or recursive loops.

## Tool-Use Boundary Enforcement

- If the model can call tools (file system, network, database), define an explicit allowlist of permitted actions.
- Never grant write access to production databases or file systems through model tool calls without human approval.
- Log all tool calls with the triggering prompt, tool name, arguments, and result for audit.

## Common Footguns

- **User input in system prompt**: direct prompt injection vector. Always use separate message roles.
- **Unvalidated model output in SQL/code**: model-generated queries or code snippets can contain injection payloads. Validate before execution.
- **Secrets in prompts**: system prompts are extractable. Never include API keys, credentials, or internal URLs.
- **RAG without document sanitization**: retrieved documents may contain injected instructions that override the system prompt.
- **No output token limit**: a malicious or confused model response can generate unbounded output, consuming API budget.
- **Model tool calls without audit logging**: if the model can take actions, every action must be logged for investigation.

## Primary Sources

- OWASP Top 10 for LLM Applications (owasp.org/www-project-top-10-for-large-language-model-applications/)
- Anthropic Prompt Engineering documentation
- NIST AI Risk Management Framework (AI RMF)
