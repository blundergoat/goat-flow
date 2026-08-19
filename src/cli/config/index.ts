/**
 * The single import path for goat-flow's config types and loader.
 *
 * Consumers import from here rather than reaching into config internals, so the parsing and validation split can change without breaking them.
 *
 * Everything exposed here describes `.goat-flow/config.yaml` after it has been parsed, defaulted, and validated.
 */
export * from "./types.js";
export * from "./reader.js";
