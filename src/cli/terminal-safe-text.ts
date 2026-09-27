/**
 * One single-line character policy for paths and fields that goat-flow prints or stores as one terminal line.
 * Keep every such validator on this constant: a separate copy that drifted let claim paths accept bidirectional controls.
 */

/**
 * C0, DEL, C1, the Arabic letter mark, LRM and RLM, line and paragraph separators, bidirectional embeddings and
 * overrides, and isolates. Each can split a displayed line or visually reorder it without changing the bytes.
 */
export const UNSAFE_SINGLE_LINE_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
