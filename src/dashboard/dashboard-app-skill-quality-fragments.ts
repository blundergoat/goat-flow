/**
 * Drive the Skills tab and Skill Evaluator UI.
 * Use when a dashboard user reviews installed skill quality, opens one skill report, or evaluates
 * pasted/dropped Markdown before deciding whether to keep, revise, or retire an artifact.
 * The helpers translate score payloads into badges, banners, clipboard summaries, and file input
 * state without making the templates re-compute report meaning.
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

/**
 * Build the headline banner for a selected skill-quality report.
 * Use when the Skills tab needs one user-readable status above the metric breakdown.
 *
 * @param ctx - dashboard app context; missing score helpers would prevent percentage-based warning copy
 * @param report - selected report; `null` means no skill report is ready to summarize
 * @returns banner title, detail, and severity; warn fallback keeps an empty selection visually neutral
 */
function dashboardSkillSummaryBanner(
  ctx: DashboardAppContext,
  report: SkillQualityReport | null,
): SkillSummaryBanner {
  // No report is selected yet, so the Skills tab keeps the headline placeholder neutral.
  if (!report) return { title: "", desc: "", severity: "warn" };
  const pct = ctx.skillReportPct(report);
  // Warning count tells the user how much non-blocking cleanup remains.
  const warnCount = report.metrics.filter(
    (metric) => metric.severity === "warn",
  ).length;
  // Failure count takes precedence because blocking skill issues need the strongest banner.
  const failCount = report.metrics.filter(
    (metric) => metric.severity === "fail",
  ).length;
  const rec = report.recommendation;
  // Failing metrics mean the user should address structural issues before trusting the skill.
  if (failCount > 0) {
    return {
      title: "Critical structural issues require attention",
      desc: `${failCount} failing metric${failCount > 1 ? "s" : ""}${
        warnCount ? ` and ${warnCount} warning${warnCount > 1 ? "s" : ""}` : ""
      }. Recommended: ${rec}.`,
      severity: "fail",
    };
  }
  // Warnings mean the skill can stay visible but still needs cleanup guidance.
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

/**
 * Build Alpine methods for loading and summarizing skill-quality reports.
 * Use when composing the dashboard app so the Skills tab can fetch, cache, and roll up reports.
 *
 * @returns dashboard fragment; empty methods are never returned because the Skills tab needs all handlers
 */
function dashboardSkillQualityReportFragment(): DashboardAppFragment {
  return {
    /**
     * Re-audit the Skills tab from scratch.
     * Use after the user clicks "Re-audit all" so stale selected reports clear before refetching.
     *
     * @returns nothing; empty state means the list will show loading until inventory returns
     */
    async reauditAllSkills() {
      this.skillQualityReport = null;
      this.skillQualitySelectedId = null;
      await this.loadSkillQualityInventory();
    },

    /**
     * Load or reuse one selected skill report.
     * Use when the user clicks a skill in the Skills tab; stale requests cannot overwrite the new selection.
     *
     * @param artifactId - selected skill artifact id; empty means no meaningful report can be fetched
     * @returns nothing; errors surface as toasts and leave the prior visible state intact
     */
    async loadSkillQualityReport(artifactId: string) {
      this.skillQualitySelectedId = artifactId;
      const cached = this.skillQualityReports[artifactId];
      // Cached reports open instantly so users can switch back without another network wait.
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
        // Server-side scoring errors become a toast instead of replacing the current report.
        if (error) {
          this.showToast(error, true);
          // The response still matches the visible project, runner, and selected skill.
        } else if (
          this.projectPath === requestProjectPath &&
          this.activeRunner === requestRunner &&
          this.skillQualitySelectedId === artifactId
        ) {
          // Same server-owned payload; this cast preserves the selected skill's report shape.
          const report = payload as unknown as SkillQualityReport;
          this.skillQualityReport = report;
          this.skillQualityReports[artifactId] = report;
        }
      } catch (err) {
        // Aborted requests mean the user picked another skill before this one finished.
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Skill quality scoring failed", true);
      }
      // Only the latest request is allowed to clear the Skills tab loading state.
      if (this.skillQualityAbortController === controller) {
        this.skillQualityLoading = false;
        this.skillQualityAbortController = null;
      }
    },

    /**
     * Convert a score ratio into the grade letter shown beside skill quality scores.
     * Use anywhere the dashboard needs the same A-F convention as Setup and Quality.
     *
     * @param pct - score ratio from 0 to 1; zero or invalid callers show the lowest grade
     * @returns grade letter for the UI; `F` means the score is below the visible D threshold
     */
    skillLetterGrade(pct: number): string {
      // Excellent scores get the strongest grade badge.
      if (pct >= 0.9) return "A";
      // Strong scores stay in the green/acceptable range.
      if (pct >= 0.8) return "B";
      // Middle scores tell the user the skill is serviceable but not strong.
      if (pct >= 0.7) return "C";
      // Low passing scores warn the user before the hard-fail grade.
      if (pct >= 0.6) return "D";
      return "F";
    },

    /**
     * Convert one skill-quality report into a 0..1 score ratio.
     * Use for progress rings, grade badges, and average calculations in the Skills tab.
     *
     * @param report - selected or cached skill report; `null` means no report is ready to grade
     * @returns score ratio; zero means the UI should show the lowest/empty score state
     */
    skillReportPct(report: SkillQualityReport | null): number {
      // Missing reports or max scores cannot produce a trustworthy percentage.
      if (!report || !report.profileMax) return 0;
      return report.totalScore / report.profileMax;
    },

    /**
     * Count cached skills with warning or failure metrics.
     * Use for the Skills tab scope strip so users see how many artifacts still need attention.
     *
     * @returns warning/failure count; zero means every cached report is currently clean
     */
    skillsWithWarningsCount(): number {
      let count = 0;
      // Scan cached reports in the same set the user sees in the Skills tab.
      for (const id in this.skillQualityReports) {
        const report = this.skillQualityReports[id];
        // Missing cache entries mean that skill has not produced a visible report yet.
        if (!report) continue;
        // Any warn/fail metric makes this skill count as needing review.
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

    /**
     * Average the score ratio across prefetched skill reports.
     * Use for the Skills tab rollup after the report list has been prefetched.
     *
     * @returns average score ratio; zero means no reports are ready yet
     */
    skillsAvgPct(): number {
      const reports = Object.values(this.skillQualityReports);
      // No prefetched reports means the rollup should stay in its empty state.
      if (reports.length === 0) return 0;
      let sum = 0;
      // Each cached report contributes the same normalized score to the rollup.
      for (const report of reports) sum += Number(this.skillReportPct(report));
      return sum / reports.length;
    },

    /**
     * Build the skills detail headline from recommendation and warn/fail counts.
     * The branch order promotes blocking findings above percentage score so a high
     * score cannot hide a small number of load-bearing structural failures because
     * review must see the risk before the aggregate grade.
     *
     * @param report - selected skill report; `null` means the Skills tab has no headline yet
     * @returns banner copy and severity; warn fallback keeps an empty selection visually neutral
     */
    skillSummaryBanner(report: SkillQualityReport | null): SkillSummaryBanner {
      return dashboardSkillSummaryBanner(this, report);
    },
  };
}

/**
 * Build Alpine methods for rendering Skill Evaluator results.
 * Use when the user scores pasted or uploaded Markdown and needs verdict, tips, and file-role labels.
 *
 * @returns dashboard fragment; empty methods are never returned because the evaluator result UI uses all handlers
 */
function dashboardSkillEvaluatorResultFragment(): DashboardAppFragment {
  return {
    /**
     * Build the verdict banner shown after a Skill Evaluator run.
     * Use when the user needs to decide whether a pasted/dropped artifact should stay a skill.
     *
     * @param report - evaluator result; `null` means no verdict is ready to show
     * @returns title and detail copy; empty strings keep the result area blank before evaluation
     */
    skillEvaluatorVerdict(report: SkillEvaluateResult | null): {
      title: string;
      desc: string;
    } {
      // No evaluator result exists yet, so the result panel stays empty.
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
      // Strong shape mismatch tells the user the artifact may be packaged as the wrong thing.
      if (shapeMismatch && shapeConfidence >= 0.7) {
        const packagedAs =
          report.artifact.kind === "skill" ? "skill" : "reference";
        title = `Packaged as ${packagedAs}, reads like ${detectedShape}`;
        // High-confidence subtype mismatch is shown before metric counts because it changes next action.
      } else if (cls.confidence >= 0.85 && detected !== report.subtype) {
        title = `This reads as a ${detected}, not a ${report.subtype}`;
        // Failing metrics mean the user needs a stronger verdict than warning copy.
      } else if (failCount > 0) {
        const tail = isHardVerdict
          ? "block ship"
          : "- needs review before keeping";
        title = `${failCount} failing metric${failCount > 1 ? "s" : ""} ${tail}`;
        // Warnings are non-blocking, so the banner keeps the artifact reviewable.
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

    /**
     * Group evaluator tips under the metric rows the user is reading.
     * Use in the result panel so advice appears beside the score it explains.
     *
     * @param report - evaluator result; `null` or no tips means there is no advice to expand
     * @returns grouped tips in metric order; empty array means the tips area stays hidden
     */
    skillEvaluatorTipGroups(report: SkillEvaluateResult | null): Array<{
      metric: string;
      label: string;
      score: number;
      maxScore: number;
      severity: SkillQualityMetricSeverity;
      tips: SkillEvaluateTip[];
    }> {
      // No result or no tips means the user has nothing to expand.
      if (!report || report.tips.length === 0) return [];
      const tipsByMetric = new Map<string, SkillEvaluateTip[]>();
      // Bucket tips by metric so each advice group follows the score row it explains.
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
      // Follow metric order from the report so the visible advice matches the score ranking.
      for (const metric of report.metrics) {
        const tips = tipsByMetric.get(metric.metric);
        // Metrics without tips do not need an empty collapsible group.
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

    /**
     * Toggle one evaluator tip group open or closed.
     * Use when the user expands advice for a specific metric.
     *
     * @param metric - metric id shown in the result; empty ids collapse under an unusable key
     * @returns nothing; the visible group state changes in place
     */
    toggleSkillEvaluatorTipGroup(metric: string) {
      this.skillEvaluatorTipCollapsed[metric] =
        !this.skillEvaluatorTipCollapsed[metric];
    },

    /**
     * Format when the Skills tab was last audited.
     * Use in the scope strip so users know whether the visible scores are fresh.
     *
     * @returns relative audit label; fallback means the UI has a report but no exact timestamp
     */
    skillAuditedRelative(): string {
      const ts = this.skillQualityAuditedAt;
      // Missing timestamp still tells the user the current data came from a recent audit.
      if (!ts) return "audited recently";
      const ms = Date.now() - ts;
      // Very fresh audits should read as immediate instead of "0 mins".
      if (ms < 60_000) return "audited just now";
      const min = Math.floor(ms / 60_000);
      // Recent audits fit better in the compact scope strip as minutes.
      if (min < 60) return `audited ${min} min${min > 1 ? "s" : ""} ago`;
      const hr = Math.floor(min / 60);
      return `audited ${hr} hr${hr > 1 ? "s" : ""} ago`;
    },

    /**
     * Label a file chip by the role users recognize in skill packages.
     * Use for composed-from rows and uploaded evaluator files.
     *
     * @param name - package-relative file name; empty or unknown names display as a generic file
     * @returns role label for the chip; `FILE` means no special skill-package role matched
     */
    skillFileRole(name: string): string {
      // Shared preamble files get their own chip because they affect every skill.
      if (name === "skill-preamble.md") return "PREAMBLE";
      // Shared conventions files get their own chip because they define workflow behavior.
      if (name === "skill-conventions.md") return "CONVENTIONS";
      // The main skill file is the user's primary artifact.
      if (name === "SKILL.md") return "SKILL";
      // Reference files are supporting material, not the main skill body.
      if (name.startsWith("references/")) return "REFERENCE";
      return "FILE";
    },

    /**
     * Generate the copyable evaluator result slug.
     * Use in the result footer so users can reference a specific scoring session later.
     *
     * @param report - evaluator result; `null` means there is no run to identify
     * @returns dated slug; empty string keeps the footer blank before evaluation
     */
    skillEvaluatorSlug(report: SkillEvaluateResult | null): string {
      // No result has been generated yet, so there is no slug to copy.
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

/**
 * Build Alpine methods for Skill Evaluator clipboard and file-input actions.
 * Use when the user copies a result, resets the form, or drops Markdown files into the evaluator.
 *
 * @returns dashboard fragment; empty methods are never returned because the evaluator form uses all handlers
 */
function dashboardSkillEvaluatorClipboardFragment(): DashboardAppFragment {
  return {
    /**
     * Copy the current evaluator result as Markdown.
     * Use when the user wants to paste the score into a PR, review note, or session summary.
     *
     * @returns nothing; missing result leaves the clipboard unchanged
     */
    async copySkillEvaluatorReport() {
      const result = this.skillEvaluatorResult;
      // No result is visible yet, so copying would give the user stale or empty text.
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
      // Copy every metric row so the pasted summary matches what the user saw.
      for (const metric of result.metrics) {
        const score =
          metric.severity === "n/a"
            ? "n/a"
            : `${metric.score}/${metric.maxScore}`;
        lines.push(`- ${metric.label}: ${score} (${metric.severity})`);
      }
      // Tips are optional; omit the section when the evaluator has no advice.
      if (result.tips.length > 0) {
        lines.push("");
        lines.push("## Improvement tips");
        // Keep tip order from the evaluator so copied advice matches the visible panel.
        for (const tip of result.tips) {
          lines.push(`- [${tip.metric}] ${tip.message}`);
        }
      }
      // Composed-from entries are optional; omit the section for single-file evaluations.
      if (result.composedFrom.length > 0) {
        lines.push("");
        lines.push("## Composed from");
        // Copy each source so users can see which files contributed to the score.
        for (const src of result.composedFrom) {
          lines.push(`- ${src}`);
        }
      }
      try {
        const ok = await this.copyTextToClipboard(lines.join("\n"));
        // Clipboard failure means the user needs a visible error instead of a false success badge.
        if (!ok) throw new Error("Clipboard write failed");
        this.skillEvaluatorReportCopied = true;
        // Existing success timers are cleared so the latest copy gets a full visible confirmation.
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
        // Failed copy attempts should remove any previous success timer immediately.
        if (this._skillEvaluatorReportCopiedTimer) {
          clearTimeout(this._skillEvaluatorReportCopiedTimer);
          this._skillEvaluatorReportCopiedTimer = null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Copy failed", true);
      }
    },

    /**
     * Reset the Skill Evaluator form and result panel.
     * Use when the user starts a fresh evaluation instead of editing the current one.
     *
     * @returns nothing; empty fields mean the evaluator returns to its first-use state
     */
    resetSkillEvaluator() {
      this.skillEvaluatorName = "";
      this.skillEvaluatorContent = "";
      this.skillEvaluatorFiles = [];
      this.skillEvaluatorDragActive = false;
      this.skillEvaluatorResult = null;
      this.skillEvaluatorError = null;
      this.skillEvaluatorLoading = false;
      this.skillEvaluatorReportCopied = false;
      // Clearing the copied badge prevents old success feedback on the empty form.
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
    },

    /**
     * Clear only the Skill Evaluator result.
     * Use when the user wants to keep the current input but remove the previous score.
     *
     * @returns nothing; `null` result means the result panel is hidden
     */
    clearSkillEvaluatorResult() {
      this.skillEvaluatorResult = null;
      this.skillEvaluatorError = null;
      this.skillEvaluatorReportCopied = false;
      // The copy-success badge belongs to the cleared result, so stop its timer too.
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
    },

    /**
     * Read dropped or selected Markdown files into the Skill Evaluator.
     * Use after the user drops files or picks them from the file input.
     *
     * @param fileList - browser file list; empty or non-Markdown files show an evaluator error
     * @returns nothing; loaded files populate chips and may prefill the suggested artifact name
     */
    async _ingestSkillEvaluatorFiles(fileList: FileList | File[]) {
      // Only Markdown-like files are evaluated so accidental binary drops do not reach scoring.
      const list = Array.from(fileList).filter(
        (file) =>
          file.name.endsWith(".md") ||
          file.name.endsWith(".markdown") ||
          file.type === "text/markdown" ||
          file.type === "text/plain",
      );
      // No valid files means the drop/input action did not give the evaluator anything to score.
      if (list.length === 0) {
        this.skillEvaluatorError =
          "Drop .md / .markdown files only (got 0 valid files).";
        return;
      }
      const reads = list.map(
        // FileReader reads each browser file so the evaluator can score local content.
        (file) =>
          new Promise<{ name: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              // String content means the Markdown file is ready for the evaluator list.
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
        // Add each new file once so duplicate drops do not create duplicate chips.
        for (const item of loaded) {
          // Duplicate filenames keep the existing chip and avoid ambiguous result rows.
          if (existing.has(item.name)) continue;
          this.skillEvaluatorFiles.push(item);
        }
        // Empty suggested name uses the first loaded filename as a helpful default.
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

    /**
     * Load files from the Skill Evaluator file picker.
     * Use when the user selects one or more local Markdown files.
     *
     * @param event - input change event; missing files mean the user cancelled the picker
     * @returns nothing; selected files are read asynchronously
     */
    loadSkillEvaluatorFile(event: Event) {
      const input = event.target as HTMLInputElement;
      // Cancelled pickers leave the evaluator unchanged.
      if (!input.files || input.files.length === 0) return;
      void this._ingestSkillEvaluatorFiles(input.files);
      input.value = "";
    },

    /**
     * Mark the evaluator dropzone active during drag-over.
     * Use so users see the panel is ready to accept Markdown files.
     *
     * @param event - drag event from the dropzone; missing data still only toggles visual state
     * @returns nothing; the dropzone highlight changes in place
     */
    skillEvaluatorDragOver(event: DragEvent) {
      event.preventDefault();
      this.skillEvaluatorDragActive = true;
    },

    /**
     * Clear the evaluator dropzone highlight when drag leaves the panel.
     * Use so moving between child elements does not flicker the active state.
     *
     * @param event - drag-leave event; missing related target clears the highlight
     * @returns nothing; the dropzone highlight changes in place
     */
    skillEvaluatorDragLeave(event: DragEvent) {
      const related = event.relatedTarget as Node | null;
      const target = event.currentTarget as Node | null;
      // Moving between children should keep the dropzone visibly active.
      if (target && related && target.contains(related)) return;
      this.skillEvaluatorDragActive = false;
    },
  };
}
