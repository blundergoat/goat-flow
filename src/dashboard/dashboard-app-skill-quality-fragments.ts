/**
 * Skill-quality view helpers for the dashboard Alpine app. This file backs the "Skills" tab: it
 * turns a SkillQualityReport into the at-a-glance summary banner the UI shows above the metric
 * breakdown, deriving a single severity (fail > warn > pass) and a human sentence from the report's
 * per-metric severities and recommendation. The banner builder is a pure projection over the
 * report, so the view layer never has to compute severity precedence itself.
 */

/**
 * The summary banner shown above the skill-quality breakdown: a title, supporting sentence, and one
 * rolled-up severity. `severity` is the worst metric severity present (fail beats warn beats pass),
 * so the banner colour always reflects the most serious issue rather than an average.
 */
interface SkillSummaryBanner {
  title: string;
  desc: string;
  severity: "pass" | "warn" | "fail";
}

function dashboardSkillSummaryBanner(
  ctx: DashboardAppContext,
  report: SkillQualityReport | null,
): SkillSummaryBanner {
  if (!report) return { title: "", desc: "", severity: "warn" };
  const pct = ctx.skillReportPct(report);
  const warnCount = report.metrics.filter(
    (metric) => metric.severity === "warn",
  ).length;
  const failCount = report.metrics.filter(
    (metric) => metric.severity === "fail",
  ).length;
  const rec = report.recommendation;
  if (failCount > 0) {
    return {
      title: "Critical structural issues require attention",
      desc: `${failCount} failing metric${failCount > 1 ? "s" : ""}${
        warnCount ? ` and ${warnCount} warning${warnCount > 1 ? "s" : ""}` : ""
      }. Recommended: ${rec}.`,
      severity: "fail",
    };
  }
  if (warnCount > 0) {
    const title =
      pct >= 0.85
        ? "Strong skill identity with adequate structural quality"
        : "Acceptable skill with non-blocking issues";
    return {
      title,
      desc: `${warnCount} non-blocking issue${
        warnCount > 1 ? "s" : ""
      }. Recommended: ${rec}, address warnings.`,
      severity: "warn",
    };
  }
  return {
    title: "All structural metrics passing",
    desc: `Recommended: ${rec}.`,
    severity: "pass",
  };
}

function dashboardSkillQualityReportFragment(): DashboardAppFragment {
  return {
    /** Re-run the inventory + prefetch from scratch - used by the page-level
     *  "Re-audit all" button. */
    async reauditAllSkills() {
      this.skillQualityReport = null;
      this.skillQualitySelectedId = null;
      await this.loadSkillQualityInventory();
    },

    /** Load or reuse one skill-quality report; reports errors and aborts prior fetches because users can switch quickly. */
    async loadSkillQualityReport(artifactId: string) {
      this.skillQualitySelectedId = artifactId;
      const cached = this.skillQualityReports[artifactId];
      if (cached) {
        this.skillQualityReport = cached;
        this.skillQualityLoading = false;
        return;
      }
      this.skillQualityAbortController?.abort();
      const controller = new AbortController();
      this.skillQualityAbortController = controller;
      const requestProjectPath = this.projectPath;
      const requestRunner = this.activeRunner;
      this.skillQualityReport = null;
      this.skillQualityLoading = true;
      try {
        const res = await dashboardFetch(
          `/api/skill-quality?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestRunner)}&artifact=${encodeURIComponent(artifactId)}`,
          { signal: controller.signal },
        );
        const payload = readRecord(await res.json(), "Skill quality report");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
        } else if (
          this.projectPath === requestProjectPath &&
          this.activeRunner === requestRunner &&
          this.skillQualitySelectedId === artifactId
        ) {
          // Same server-owned /api/skill-quality payload; TS needs the unknown
          // hop here too because JsonRecord and SkillQualityReport don't overlap.
          const report = payload as unknown as SkillQualityReport;
          this.skillQualityReport = report;
          this.skillQualityReports[artifactId] = report;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Skill quality scoring failed", true);
      }
      if (this.skillQualityAbortController === controller) {
        this.skillQualityLoading = false;
        this.skillQualityAbortController = null;
      }
    },

    /** Map a 0..1 ratio to an A/B/C/D/F letter grade. Matches the convention
     *  used on the Setup and Quality pages (≥0.9 A, ≥0.8 B, ≥0.7 C, ≥0.6 D). */
    skillLetterGrade(pct: number): string {
      if (pct >= 0.9) return "A";
      if (pct >= 0.8) return "B";
      if (pct >= 0.7) return "C";
      if (pct >= 0.6) return "D";
      return "F";
    },

    /** Convert a skill-quality report score to a 0..1 ratio. */
    skillReportPct(report: SkillQualityReport | null): number {
      if (!report || !report.profileMax) return 0;
      return report.totalScore / report.profileMax;
    },

    /** Aggregate count of skills whose stored report has at least one
     *  warn/fail metric. Used for the scope-strip "N with warnings" line. */
    skillsWithWarningsCount(): number {
      let count = 0;
      for (const id in this.skillQualityReports) {
        const report = this.skillQualityReports[id];
        if (!report) continue;
        if (
          report.metrics.some(
            (metric: SkillQualityMetric) =>
              metric.severity === "warn" || metric.severity === "fail",
          )
        )
          count++;
      }
      return count;
    },

    /** Mean score across all prefetched reports as a 0..1 ratio. */
    skillsAvgPct(): number {
      const reports = Object.values(this.skillQualityReports);
      if (reports.length === 0) return 0;
      let sum = 0;
      for (const report of reports) sum += Number(this.skillReportPct(report));
      return sum / reports.length;
    },

    /**
     * Build the skills detail headline from recommendation and warn/fail counts.
     * The branch order promotes blocking findings above percentage score so a high
     * score cannot hide a small number of load-bearing structural failures because
     * review must see the risk before the aggregate grade.
     */
    skillSummaryBanner(report: SkillQualityReport | null): SkillSummaryBanner {
      return dashboardSkillSummaryBanner(this, report);
    },
  };
}

function dashboardSkillEvaluatorResultFragment(): DashboardAppFragment {
  return {
    /** Verdict-banner copy for the Skill Evaluator result.
     *
     *  The headline title softens its tone to match the recommendation: a
     *  `needs-human-review` verdict says "needs review before keeping", not
     *  "block ship" - "block ship" is reserved for verdicts that the engine
     *  is genuinely confident about (retire / consider-revision). Mismatch
     *  between pill and copy was confusing readers about how confident the
     *  engine actually is. */
    skillEvaluatorVerdict(report: SkillEvaluateResult | null): {
      title: string;
      desc: string;
    } {
      if (!report) return { title: "", desc: "" };
      const cls = report.classification;
      const detected = cls.detectedSubtype;
      const detectedShape = report.detectedShape ?? detected;
      const shapeConfidence = report.shapeConfidence ?? cls.confidence;
      const shapeMismatch =
        report.shapeMismatch ?? detectedShape !== report.subtype;
      const failCount = report.metrics.filter(
        (metric) => metric.severity === "fail",
      ).length;
      const warnCount = report.metrics.filter(
        (metric) => metric.severity === "warn",
      ).length;
      const isHardVerdict =
        report.recommendation === "retire" ||
        report.recommendation === "consider-revision";
      let title = "";
      if (shapeMismatch && shapeConfidence >= 0.7) {
        const packagedAs =
          report.artifact.kind === "skill" ? "skill" : "reference";
        title = `Packaged as ${packagedAs}, reads like ${detectedShape}`;
      } else if (cls.confidence >= 0.85 && detected !== report.subtype) {
        title = `This reads as a ${detected}, not a ${report.subtype}`;
      } else if (failCount > 0) {
        const tail = isHardVerdict
          ? "block ship"
          : "- needs review before keeping";
        title = `${failCount} failing metric${failCount > 1 ? "s" : ""} ${tail}`;
      } else if (warnCount > 0) {
        title = `${warnCount} non-blocking warning${warnCount > 1 ? "s" : ""}`;
      } else {
        title = "All structural metrics passing";
      }
      const recHuman =
        report.recommendation === "needs-human-review"
          ? "Manual review required"
          : report.recommendation === "consider-reclassifying"
            ? "Consider reclassifying"
            : report.recommendation === "consider-revision"
              ? "Revise before shipping"
              : report.recommendation === "retire"
                ? "Retire or rewrite"
                : report.recommendation === "reference-playbook"
                  ? "Ship as a reference"
                  : "Keep as a skill";
      const detail =
        shapeMismatch && shapeConfidence >= 0.7
          ? `${Math.round(shapeConfidence * 100)}% shape confidence`
          : cls.confidence >= 0.85 && detected !== report.subtype
            ? `${Math.round(cls.confidence * 100)}% ${detected} classification`
            : `${failCount + warnCount} non-passing metric${
                failCount + warnCount === 1 ? "" : "s"
              }`;
      return {
        title,
        desc: `${detail}. ${recHuman} before deciding to keep, convert, or discard.`,
      };
    },

    /** Group improvement tips by their metric so the modal result can render
     *  one collapsible cluster per metric (with the metric's score in the
     *  header). Order follows the metrics array (ranking from skill-quality.ts). */
    skillEvaluatorTipGroups(report: SkillEvaluateResult | null): Array<{
      metric: string;
      label: string;
      score: number;
      maxScore: number;
      severity: SkillQualityMetricSeverity;
      tips: SkillEvaluateTip[];
    }> {
      if (!report || report.tips.length === 0) return [];
      const tipsByMetric = new Map<string, SkillEvaluateTip[]>();
      for (const tip of report.tips) {
        const arr = tipsByMetric.get(tip.metric) ?? [];
        arr.push(tip);
        tipsByMetric.set(tip.metric, arr);
      }
      const groups: Array<{
        metric: string;
        label: string;
        score: number;
        maxScore: number;
        severity: SkillQualityMetricSeverity;
        tips: SkillEvaluateTip[];
      }> = [];
      for (const metric of report.metrics) {
        const tips = tipsByMetric.get(metric.metric);
        if (!tips || tips.length === 0) continue;
        groups.push({
          metric: metric.metric,
          label: metric.label,
          score: metric.score,
          maxScore: metric.maxScore,
          severity: metric.severity,
          tips,
        });
      }
      return groups;
    },

    toggleSkillEvaluatorTipGroup(metric: string) {
      this.skillEvaluatorTipCollapsed[metric] =
        !this.skillEvaluatorTipCollapsed[metric];
    },

    /** Pretty "audited just now / 3 minutes ago" formatter for the scope strip. */
    skillAuditedRelative(): string {
      const ts = this.skillQualityAuditedAt;
      if (!ts) return "audited recently";
      const ms = Date.now() - ts;
      if (ms < 60_000) return "audited just now";
      const min = Math.floor(ms / 60_000);
      if (min < 60) return `audited ${min} min${min > 1 ? "s" : ""} ago`;
      const hr = Math.floor(min / 60);
      return `audited ${hr} hr${hr > 1 ? "s" : ""} ago`;
    },

    /** Pill-style file-role label used in the composed-from list and evaluator
     *  file chips. */
    skillFileRole(name: string): string {
      if (name === "skill-preamble.md") return "PREAMBLE";
      if (name === "skill-conventions.md") return "CONVENTIONS";
      if (name === "SKILL.md") return "SKILL";
      if (name.startsWith("references/")) return "REFERENCE";
      return "FILE";
    },

    /** Generate a stable slug for an evaluator result. Used in the result
     *  footer as a copyable identifier so users can reference a specific
     *  evaluation run later (e.g. when comparing two scoring sessions). */
    skillEvaluatorSlug(report: SkillEvaluateResult | null): string {
      if (!report) return "";
      const today = new Date().toISOString().slice(0, 10);
      const safe = (report.artifact.name || "skill")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return `evaluation-${today}-${safe}`;
    },
  };
}

function dashboardSkillEvaluatorClipboardFragment(): DashboardAppFragment {
  return {
    /** Copy a markdown summary of the current evaluation result to the user's
     *  clipboard. The format mirrors what the engine itself emits so the
     *  result can be pasted into PR descriptions or session notes. */
    async copySkillEvaluatorReport() {
      const result = this.skillEvaluatorResult;
      if (!result) return;
      const lines: string[] = [];
      const pct = Math.round(this.skillReportPct(result) * 100);
      const grade = this.skillLetterGrade(this.skillReportPct(result));
      lines.push(`# ${result.artifact.name} - ${grade} ${pct}%`);
      lines.push(`Slug: \`${this.skillEvaluatorSlug(result)}\``);
      lines.push(
        `Subtype: ${result.subtype} (${Math.round(result.classification.confidence * 100)}% ${result.classification.detectedSubtype})`,
      );
      if (result.shapeMismatch && result.detectedShape) {
        lines.push(
          `Detected shape: ${result.detectedShape} (${Math.round((result.shapeConfidence ?? 0) * 100)}%)`,
        );
      }
      lines.push(`Verdict: \`${result.recommendation}\``);
      lines.push(`Score: ${result.totalScore} / ${result.profileMax}`);
      lines.push("");
      lines.push("## Structural metrics");
      for (const metric of result.metrics) {
        const score =
          metric.severity === "n/a"
            ? "n/a"
            : `${metric.score}/${metric.maxScore}`;
        lines.push(`- ${metric.label}: ${score} (${metric.severity})`);
      }
      if (result.tips.length > 0) {
        lines.push("");
        lines.push("## Improvement tips");
        for (const tip of result.tips) {
          lines.push(`- [${tip.metric}] ${tip.message}`);
        }
      }
      if (result.composedFrom.length > 0) {
        lines.push("");
        lines.push("## Composed from");
        for (const src of result.composedFrom) {
          lines.push(`- ${src}`);
        }
      }
      try {
        const ok = await this.copyTextToClipboard(lines.join("\n"));
        if (!ok) throw new Error("Clipboard write failed");
        this.skillEvaluatorReportCopied = true;
        if (this._skillEvaluatorReportCopiedTimer) {
          clearTimeout(this._skillEvaluatorReportCopiedTimer);
        }
        this._skillEvaluatorReportCopiedTimer = setTimeout(() => {
          this.skillEvaluatorReportCopied = false;
          this._skillEvaluatorReportCopiedTimer = null;
        }, 4000);
        this.showToast("Report copied to clipboard");
      } catch (err) {
        this.skillEvaluatorReportCopied = false;
        if (this._skillEvaluatorReportCopiedTimer) {
          clearTimeout(this._skillEvaluatorReportCopiedTimer);
          this._skillEvaluatorReportCopiedTimer = null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Copy failed", true);
      }
    },

    // -- Skill evaluator page --
    resetSkillEvaluator() {
      this.skillEvaluatorName = "";
      this.skillEvaluatorContent = "";
      this.skillEvaluatorFiles = [];
      this.skillEvaluatorDragActive = false;
      this.skillEvaluatorResult = null;
      this.skillEvaluatorError = null;
      this.skillEvaluatorLoading = false;
      this.skillEvaluatorReportCopied = false;
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
    },

    clearSkillEvaluatorResult() {
      this.skillEvaluatorResult = null;
      this.skillEvaluatorError = null;
      this.skillEvaluatorReportCopied = false;
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
    },

    /** Read multiple `.md` files via FileReader; populates the file list and
     *  pre-fills the suggestedName from the first file. Skips non-markdown
     *  inputs and surfaces a per-file error if any one fails. */
    async _ingestSkillEvaluatorFiles(fileList: FileList | File[]) {
      const list = Array.from(fileList).filter(
        (file) =>
          file.name.endsWith(".md") ||
          file.name.endsWith(".markdown") ||
          file.type === "text/markdown" ||
          file.type === "text/plain",
      );
      if (list.length === 0) {
        this.skillEvaluatorError =
          "Drop .md / .markdown files only (got 0 valid files).";
        return;
      }
      const reads = list.map(
        (file) =>
          new Promise<{ name: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                resolve({ name: file.name, content: reader.result });
              } else {
                reject(new Error(`Could not read ${file.name}`));
              }
            };
            reader.onerror = () => {
              reject(new Error(`Could not read ${file.name}`));
            };
            reader.readAsText(file);
          }),
      );
      try {
        const loaded = await Promise.all(reads);
        const existing = new Set(
          this.skillEvaluatorFiles.map(
            (file: { name: string; content: string }) => file.name,
          ),
        );
        for (const item of loaded) {
          if (existing.has(item.name)) continue;
          this.skillEvaluatorFiles.push(item);
        }
        if (!this.skillEvaluatorName && this.skillEvaluatorFiles[0]) {
          const first = this.skillEvaluatorFiles[0];
          this.skillEvaluatorName = first.name.replace(/\.(md|markdown)$/i, "");
        }
        this.skillEvaluatorError = null;
      } catch (err) {
        this.skillEvaluatorError =
          err instanceof Error ? err.message : String(err);
      }
    },

    /** File input change handler (multi-select). */
    loadSkillEvaluatorFile(event: Event) {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      void this._ingestSkillEvaluatorFiles(input.files);
      input.value = "";
    },

    /** dragover handler - keep the dropzone visually active. */
    skillEvaluatorDragOver(event: DragEvent) {
      event.preventDefault();
      this.skillEvaluatorDragActive = true;
    },

    /** dragleave handler - only clear when leaving the evaluator panel itself. */
    skillEvaluatorDragLeave(event: DragEvent) {
      const related = event.relatedTarget as Node | null;
      const target = event.currentTarget as Node | null;
      if (target && related && target.contains(related)) return;
      this.skillEvaluatorDragActive = false;
    },
  };
}
