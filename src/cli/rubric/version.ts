/**
 * Version markers for the rubric and JSON schema.
 * RUBRIC_VERSION tracks the package version so they can't drift.
 * SCHEMA_VERSION is independent - bump when report field names/types change.
 */
import { getPackageVersion } from "../paths.js";

/** Rubric version - derived from package.json so it stays in sync automatically. */
export const RUBRIC_VERSION = getPackageVersion();

/** JSON report schema version - bump when report field names/types change. */
export const SCHEMA_VERSION = "3";
