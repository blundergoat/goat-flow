/**
 * Client-side markdown renderer wrapper for the goat-flow dashboard (M32).
 *
 * Loaded as a classic script after `/assets/markdown-it.js` and
 * `/assets/js-yaml.js` (UMD builds).
 * Exposes `window.renderMarkdown` so the markdown viewer modal (M18) and any
 * other consumer can render footgun/lesson/ADR/session/playbook content
 * without each call site re-inventing sanitization.
 *
 * Rendering contract:
 *   - `html: false`        - raw HTML in source is escaped (defence-in-depth).
 *   - GFM tables, fenced code blocks, autolinks, line breaks all enabled.
 *   - Frontmatter (`---\n…\n---`) is stripped by default and surfaced as a
 *     parsed object on the result. Set `frontmatter: "passthrough"` to keep
 *     it in the rendered HTML.
 *
 * Frontmatter parsing uses `js-yaml` so nested arrays/objects in future
 * artifacts do not need another dashboard renderer change.
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
  /** Render markdown text to sanitized HTML according to the configured markdown-it options. */
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

interface JsYamlGlobal {
  /** Parse YAML frontmatter into JavaScript data for the dashboard metadata panel. */
  load(text: string): unknown;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parse frontmatter only when js-yaml is loaded and the YAML root is an object. */
function parseFrontmatter(block: string): Record<string, unknown> | null {
  const yaml = (window as { jsyaml?: JsYamlGlobal }).jsyaml;
  if (!yaml) return null;
  const parsed = yaml.load(block);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** Build the global markdown renderer with reusable line-break and no-line-break instances. */
function buildRenderer(): (
  text: string,
  opts?: RenderMarkdownOptions,
) => RenderMarkdownResult {
  const md = (window as { markdownit?: MarkdownItGlobal }).markdownit;
  if (!md) {
    return () => ({
      html: '<pre class="gf-md-error">markdown-it not loaded</pre>',
      frontmatter: null,
    });
  }
  const defaultInstance = md({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  });
  const noBreaksInstance = md({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  return (text: string, opts: RenderMarkdownOptions = {}) => {
    let body = text;
    let frontmatter: Record<string, unknown> | null = null;
    const match = body.match(FRONTMATTER_RE);
    if (match) {
      const parsedFrontmatter = parseFrontmatter(match[1] ?? "");
      if (parsedFrontmatter && opts.frontmatter !== "passthrough") {
        body = body.slice(match[0].length);
      }
      frontmatter = parsedFrontmatter;
    }
    const instance = opts.breaks === false ? noBreaksInstance : defaultInstance;
    return { html: instance.render(body), frontmatter };
  };
}

window.renderMarkdown = buildRenderer();
