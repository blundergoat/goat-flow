/**
 * Regression tests for M02 (1.13.0): the dashboard shell must load ALL
 * executable scripts from local /assets/ routes, never from a CDN.
 *
 * The dashboard is a local page that can open terminals and drive agents on
 * the user's machine - a remote script origin (jsdelivr, unpkg, ...) would
 * mean the page a user trusts with shell access executes whatever a third
 * party serves that day, and would break entirely offline. These tests pin
 * the source shell; the build step copies the same file into dist.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellPath = fileURLToPath(
  new URL("../../src/dashboard/index.html", import.meta.url),
);
const stylesPath = fileURLToPath(
  new URL("../../src/dashboard/styles.css", import.meta.url),
);

describe("dashboard shell asset origins", () => {
  const shell = readFileSync(shellPath, "utf-8");

  it("contains no external script sources", () => {
    // Any <script src="http(s)://..."> is remote executable code - forbidden.
    const externalScripts = shell.match(/<script[^>]*src="https?:\/\/[^"]*"/g);
    assert.equal(
      externalScripts,
      null,
      `external script tags found: ${externalScripts?.join(", ")}`,
    );
  });

  it("contains no CDN hostnames anywhere in the shell", () => {
    // Belt-and-braces: catches stylesheet/prefetch regressions too, not just scripts.
    assert.doesNotMatch(
      shell,
      /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/,
    );
  });

  it("loads Alpine and Tailwind from local /assets/ routes", () => {
    assert.match(shell, /<script src="\/assets\/tailwind\.js"><\/script>/);
    assert.match(shell, /<script defer src="\/assets\/alpine\.js"><\/script>/);
  });
});

describe("dashboard stylesheet asset origins", () => {
  // The build copies this file verbatim into dist/dashboard/styles.css, so
  // pinning the source keeps the shipped stylesheet offline too. A remote
  // @import (e.g. Google Fonts) would fetch across origins - forbidden here.
  const styles = readFileSync(stylesPath, "utf-8");

  it("contains no remote @import", () => {
    // An @import of an http(s) URL pulls remote CSS/fonts at render time.
    const remoteImports = styles.match(
      /@import\s+url\(\s*["']?https?:\/\/[^)]*\)/g,
    );
    assert.equal(
      remoteImports,
      null,
      `remote @import found: ${remoteImports?.join(", ")}`,
    );
  });

  it("contains no external origins anywhere", () => {
    // Any absolute http(s) URL (fonts, images, CSS) is an external origin.
    const externalUrls = styles.match(/https?:\/\/[^\s"')]+/g);
    assert.equal(
      externalUrls,
      null,
      `external URL(s) found in stylesheet: ${externalUrls?.join(", ")}`,
    );
  });
});
