/**
 * The public entry point for skill-quality scoring: discovering installed skills, scoring them, and evaluating pasted drafts.
 *
 * A user reaches this from the dashboard Skills tab or the Skill Evaluator, asking how good their installed skills actually are.
 *
 * This file only re-exports; the scoring rules live in the sibling modules so callers depend on one stable surface.
 */
export type { SkillQualityReport } from "./skill-quality-types.js";
export { discoverArtifacts, findArtifact } from "./skill-quality-content.js";
export { scoreAllArtifacts, scoreArtifact } from "./skill-quality-score.js";
export {
  evaluateContent,
  evaluateUploadedBundle,
} from "./skill-quality-upload.js";
