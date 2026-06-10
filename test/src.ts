/**
 * Test-only facade for production modules used by deeply nested test fixtures.
 * Keeps audit and quality tests on stable, shallow imports without changing the package export surface.
 */
export {
  computeHarness,
  createAuditFactsView,
  runAudit,
  runAuditBatch,
} from "../src/cli/audit/audit.js";
export { computeContent } from "../src/cli/audit/audit-content.js";
export { shouldAutoRunDrift } from "../src/cli/audit/audit-drift-policy.js";
export {
  labelEvidencePathBases,
  validateRegisteredCheckProvenance,
} from "../src/cli/audit/audit-provenance.js";
export { buildProjectStructure } from "../src/cli/audit/audit-structure.js";
export {
  agentSummary,
  setupSummary,
} from "../src/cli/audit/audit-summaries.js";
export {
  checkSelectedInstructionAvailable,
  incidentProvenance,
  specProvenance,
  uniquePaths,
} from "../src/cli/audit/check-agent-common.js";
export { agentDenyMechanism } from "../src/cli/audit/check-agent-deny-mechanism.js";
export { scanSemanticDrift } from "../src/cli/audit/check-factual-semantic-drift.js";
export { AGENT_CHECKS } from "../src/cli/audit/check-agent-setup.js";
export { SETUP_CHECKS } from "../src/cli/audit/check-goat-flow.js";
export { CONSTRAINTS_CHECKS } from "../src/cli/audit/harness/check-constraints.js";
export { FEEDBACK_LOOP_CHECKS } from "../src/cli/audit/harness/check-feedback-loop.js";
export { RECOVERY_CHECKS } from "../src/cli/audit/harness/check-recovery.js";
export { VERIFICATION_CHECKS } from "../src/cli/audit/harness/check-verification.js";
export { extractBacktickPaths } from "../src/cli/audit/harness/helpers.js";
export { HARNESS_CHECKS } from "../src/cli/audit/harness/index.js";
export {
  renderAuditJson,
  renderAuditMarkdown,
  renderAuditText,
} from "../src/cli/audit/render.js";
export { renderAuditSarif } from "../src/cli/audit/sarif.js";
export { parseCLIArgs } from "../src/cli/cli.js";
export { AUDIT_VERSION, SKILL_NAMES } from "../src/cli/constants.js";
export { PROFILES } from "../src/cli/detect/agents.js";
export {
  buildDenyRegistration,
  buildHookRegistration,
  readHookConfig,
} from "../src/cli/facts/agent/hook-registration.js";
export { extractHookFacts } from "../src/cli/facts/agent/hooks.js";
export { extractSettingsFacts } from "../src/cli/facts/agent/settings.js";
export { extractSkillFacts } from "../src/cli/facts/agent/skills.js";
export { createFS } from "../src/cli/facts/fs.js";
export { extractProjectFacts } from "../src/cli/facts/orchestrator.js";
export { composeSetup } from "../src/cli/prompt/compose-setup.js";
export {
  discoverArtifacts,
  findArtifact,
} from "../src/cli/quality/skill-quality-content.js";
export {
  scoreAllArtifacts,
  scoreArtifact,
} from "../src/cli/quality/skill-quality.js";
export {
  evaluateContent,
  evaluateUploadedBundle,
} from "../src/cli/quality/skill-quality-upload.js";
export {
  cloneQualityConfig,
  DEFAULT_QUALITY_CONFIG,
} from "../src/cli/quality/quality-config.js";

export type {
  AuditContext,
  AuditReport,
  ProjectStructure,
} from "../src/cli/audit/types.js";
export type { GoatFlowConfig, LoadedConfig } from "../src/cli/config/types.js";
export type {
  AgentFacts,
  AgentId,
  AgentProfile,
  ProjectFacts,
  ReadonlyFS,
} from "../src/cli/types.js";
