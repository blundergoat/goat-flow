/**
 * The single import path for the quality-report schema: its constants, types, and validator.
 *
 * This is the contract a saved report must satisfy to stay loadable by `quality history` and `quality diff`.
 *
 * Validation internals live in smaller sibling modules, so callers depend on one stable surface rather than the split.
 */
export {
  QUALITY_MODES,
  QUALITY_REPORT_KIND,
  type QualityFinding,
  type QualityMode,
  type QualityReport,
  type SavedQualityFinding,
  type SavedQualityReport,
} from "./schema-types.js";
export { parseQualityReport } from "./schema-parser.js";
