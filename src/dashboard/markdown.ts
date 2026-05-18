/**
 * Client-side markdown renderer wrapper for the goat-flow dashboard (M32).
 *
 * Loaded as a classic script after `/assets/markdown-it.js` (the UMD build).
 * Exposes `window.renderMarkdown` so the markdown viewer modal (M18) and any
 * other consumer can render footgun/lesson/ADR/session/playbook content
 * without each call site re-inventing sanitization.
 *
 * Rendering contract:
 *   - `html: false`        — raw HTML in source is ignored (defence-in-depth).
 *   - GFM tables, fenced code blocks, autolinks, line breaks all enabled.
 *   - Frontmatter (`---\n…\n---`) is stripped by default and surfaced as a
 *     parsed object on the result. Set `frontmatter: "passthrough"` to keep
 *     it in the rendered HTML.
 *
 * Frontmatter parsing intentionally only handles flat scalar keys (`key:
 * value`) because every committed goat-flow artifact uses that shape today.
 * Nested YAML is not supported here; consumers needing it should call
 * `js-yaml` directly.
 */
interface RenderMarkdownOptions {
  /** "strip" (default): drop the YAML block. "passthrough": leave it in. */
  frontmatter?: "strip" | "passthrough";
  /** Enable GFM line breaks. Defaults to true. */
  breaks?: boolean;
}

interface RenderMarkdownResult {
  html: string;
  frontmatter: Record<string, unknown> | null;
}

interface MarkdownItInstance {
  render(text: string): string;
}

interface MarkdownItGlobal {
  (options?: {
    html?: boolean;
    linkify?: boolean;
    breaks?: boolean;
    typographer?: boolean;
  }): MarkdownItInstance;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalarFrontmatter(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, valueRaw] = match;
    if (!key) continue;
    const value = (valueRaw ?? "").trim().replace(/^"(.*)"$/u, "$1");
    if (value === "true") out[key] = true;
    else if (value === "false") out[key] = false;
    else if (value !== "" && /^-?\d+(?:\.\d+)?$/.test(value))
      out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

function buildRenderer(): (
  text: string,
  opts?: RenderMarkdownOptions,
) => RenderMarkdownResult {
  const md = (window as unknown as { markdownit?: MarkdownItGlobal })
    .markdownit;
  if (!md) {
    return () => ({
      html: '<pre class="gf-md-error">markdown-it not loaded</pre>',
      frontmatter: null,
    });
  }
  const instance = md({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  });
  return (text: string, opts: RenderMarkdownOptions = {}) => {
    let body = text;
    let frontmatter: Record<string, unknown> | null = null;
    const match = body.match(FRONTMATTER_RE);
    if (match) {
      frontmatter = parseScalarFrontmatter(match[1] ?? "");
      if (opts.frontmatter !== "passthrough") {
        body = body.slice(match[0].length);
      }
    }
    return { html: instance.render(body), frontmatter };
  };
}

window.renderMarkdown = buildRenderer();
