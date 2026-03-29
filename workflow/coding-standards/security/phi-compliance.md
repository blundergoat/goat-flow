# PHI/Healthcare Compliance Security

Reference for generating `ai/instructions/security.md` in projects handling Protected Health Information (PHI) or operating under healthcare compliance requirements (HIPAA, GDPR health data, etc.).

## Minimum Necessary Principle

- Send only the data the model/service/log needs, never full patient records.
- When building LLM context windows, include only the specific fields required for the task — not the entire patient object.
- API responses should return only requested fields. Never return a full patient record when the consumer needs only name and appointment time.

```python
# DO — select only needed fields
patient_context = {
    "age": patient.age,
    "chief_complaint": patient.chief_complaint,
    "relevant_history": patient.relevant_medical_history,
}

# DON'T — pass the entire record
patient_context = patient.to_dict()  # includes SSN, address, insurance, etc.
```

## Tenant Scoping

- Every query touching PHI must be scoped to the current tenant. A missing tenant filter is a cross-tenant PHI leak.
- Enforce tenant scoping at the query layer (repository/service), not just at the controller. A missing scope check in one code path exposes all patients.

```python
# DO — scope every PHI query to tenant
def get_patients(tenant_id: int, db: Session):
    return db.query(Patient).filter(Patient.tenant_id == tenant_id).all()

# DON'T — unscoped query
def get_patients(db: Session):
    return db.query(Patient).all()  # returns ALL patients across ALL tenants
```

- In multi-tenant healthcare SaaS, cross-tenant data leakage is the highest-risk failure mode. Treat it as a Never boundary, not Ask First.

## Audit Trail

- Log all PHI access with: who (user ID), when (timestamp), what (record ID, fields accessed), why (action/reason).
- Audit logs must be immutable — write to an append-only store that the application cannot modify or delete.
- Retain audit logs per jurisdictional requirements (HIPAA: 6 years minimum).

```python
# DO — structured audit log for PHI access
audit_logger.info("phi_access",
    user_id=request.user.id,
    patient_id=patient.id,
    fields_accessed=["name", "diagnosis", "medications"],
    action="view_patient_summary",
    ip=request.remote_addr,
)
```

## PHI in Logs and Error Messages

- Never log PHI in application logs, error messages, or exception traces.
- Mask or exclude patient identifiers (name, DOB, SSN, MRN) from all log output.
- If using error tracking services (Sentry, Datadog), configure scrubbing rules to strip PHI before transmission.

```python
# DO — log record ID only, no PHI
logger.error("Failed to process record", patient_id=patient.id, error=str(e))

# DON'T — log patient details
logger.error(f"Failed to process {patient.name} DOB {patient.dob}: {e}")
```

## Data Retention and Deletion

- Define retention periods per data type and jurisdiction. PHI retention requirements vary (HIPAA: varies by state, typically 6-10 years).
- Implement soft-delete with scheduled hard-delete for PHI. Immediate hard-delete may conflict with audit trail requirements.
- De-identify data before use in analytics, reporting, or LLM fine-tuning. Follow HIPAA Safe Harbor or Expert Determination method.

## LLM + PHI Intersection

If the project has both compliance signals and LLM integration:

- Apply minimum-necessary disclosure in all model prompts — never pass full patient records.
- Validate model outputs deterministically before writing to PHI-containing database tables.
- Log all model interactions involving PHI context for audit (prompt, response, patient IDs involved).
- Model responses may reproduce PHI from the context window — validate and redact before storing or displaying.

## Common Footguns

- **Unscoped queries**: missing `tenant_id` filter returns all patients across tenants. Always scope at the query layer.
- **PHI in error messages**: stack traces sent to clients or error tracking services may contain patient data.
- **Full records in API responses**: returning `patient.to_dict()` instead of specific fields leaks unnecessary PHI.
- **Mutable audit logs**: if the application can delete or modify audit entries, the audit trail is meaningless for compliance.
- **De-identification gaps**: removing the name but keeping DOB + zip code + diagnosis may still be re-identifiable.
- **LLM context leakage**: model reproduces PHI from a previous turn or cached context. Validate all model output before display.

## Primary Sources

- HIPAA Security Rule (45 CFR Part 164)
- HIPAA Safe Harbor De-Identification Method
- NIST SP 800-66 (HIPAA Security Rule guidance)
- OWASP Top 10 for LLM Applications (for LLM + PHI intersection)
