import type { ComposedPrompt } from './types.js';

/**
 * Render a composed prompt as pasteable markdown.
 * Output is wrapped in a code fence for easy copy-paste.
 */
export function renderPrompt(prompt: ComposedPrompt): string {
  const lines: string[] = [];

  lines.push(`# ${prompt.title}`);
  lines.push('');
  lines.push(prompt.preamble);
  lines.push('');
  lines.push('---');

  for (const section of prompt.sections) {
    lines.push('');
    lines.push(`## ${section.heading}`);
    lines.push('');

    // Group fragments by category within each section
    const byCategory = groupByCategory(section.fragments);

    for (const [category, fragments] of byCategory) {
      if (byCategory.size > 1) {
        lines.push(`### ${category}`);
        lines.push('');
      }

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

function groupByCategory(fragments: Array<{ key: string; category: string; instruction: string }>): Map<string, typeof fragments> {
  const map = new Map<string, typeof fragments>();
  for (const f of fragments) {
    const group = map.get(f.category) ?? [];
    group.push(f);
    map.set(f.category, group);
  }
  return map;
}
