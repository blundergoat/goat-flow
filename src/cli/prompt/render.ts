import type { ComposedPrompt } from './types.js';

/**
 * Render a composed prompt as pasteable markdown.
 */
export function renderPrompt(prompt: ComposedPrompt): string {
  /** Accumulated output lines joined into the final markdown string */
  const lines: string[] = [];

  lines.push(`# ${prompt.title}`);
  lines.push('');
  lines.push(prompt.preamble);
  lines.push('');
  lines.push('---');

  // Iterate over each section to emit its heading and fragments
  for (const section of prompt.sections) {
    lines.push('');
    lines.push(`## ${section.heading}`);
    lines.push('');

    /** Fragments grouped by their category within this section */
    const byCategory = groupByCategory(section.fragments);

    // Iterate over each category group to emit optional sub-headings and instructions
    for (const [category, fragments] of byCategory) {
      if (byCategory.size > 1) {
        lines.push(`### ${category}`);
        lines.push('');
      }

      // Iterate over each fragment to append its instruction text
      for (const fragment of fragments) {
        lines.push(fragment.instruction);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(prompt.summary);

  return lines.join('\n');
}

/** Group an array of fragments into a map keyed by category */
function groupByCategory(fragments: Array<{ key: string; category: string; instruction: string }>): Map<string, typeof fragments> {
  /** Map from category name to its fragment list */
  const map = new Map<string, typeof fragments>();
  // Iterate over each fragment to bucket it into the correct category group
  for (const f of fragments) {
    /** Existing group for this category, or a fresh empty array */
    const group = map.get(f.category) ?? [];
    group.push(f);
    map.set(f.category, group);
  }
  return map;
}
