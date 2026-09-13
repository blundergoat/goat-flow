/**
 * Present skill scores and evaluator actions in the dashboard's Skills tab.
 *
 * Use these helpers when users review installed skills or score pasted and locally selected Markdown.
 * They turn reports into banners, grades, copied summaries, and file-picker state.
 */

/**
 * Summarize the selected skill above its metric breakdown.
 *
 * Failures take priority over warnings; incomplete evidence also keeps the banner at warning severity.
 * An empty selection has no banner text, so the report panel can remain blank.
 */
interface SkillSummaryBanner {
  title: string;
  desc: string;
  severity: "pass" | "warn" | "fail";
}

/**
 * Return evidence-limit notes that temper a score without pretending a structural metric failed.
 *
 * @param report - selected or evaluated report; `null` has no evidence surface to inspect
 * @returns truncation notes in report order; other fit guidance remains recommendation context
 */
function dashboardSkillEvidenceLimitNotes(
  report: SkillQualityReport | null,
): string[] {
  // Before a report is available, there is no partial-evidence warning to show.
  if (!report) return [];
  return report.fitNotes.filter((note) =>
    /^(?:artifact|composition) truncated at\b/iu.test(note),
  );
}

/**
 * Build the Markdown copied from an evaluator result, keeping the report's metric order.
 * Use after Copy report so the exported score, grade, and slug match the result panel.
 *
 * @param appContext - dashboard app context, used for the same grade, percentage, and slug helpers the panel displays
 * @param result - evaluated artifact; empty tips or source lists omit those sections from the copied report
 * @returns the Markdown document; never empty
 */
function buildEvaluatorReportMarkdown(
  appContext: DashboardAppContext,
  result: SkillEvaluateResult,
): string {
  const lines: string[] = [];
  const scorePercent = Math.round(appContext.skillReportPct(result) * 100);
  const grade = appContext.skillLetterGrade(appContext.skillReportPct(result));
  lines.push(`# ${result.artifact.name} - ${grade} ${scorePercent}%`);
  lines.push(`Slug: \`${appContext.skillEvaluatorSlug(result)}\``);
  lines.push(
    `Subtype: ${result.subtype} (${Math.round(result.classification.confidence * 100)}% ${result.classification.detectedSubtype})`,
  );
  // A detected shape only matters to the reader when it disagrees with how the artifact is filed.
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
      metric.severity === "n/a" ? "n/a" : `${metric.score}/${metric.maxScore}`;
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
    for (const sourcePath of result.composedFrom) {
      lines.push(`- ${sourcePath}`);
    }
  }
  return lines.join("\n");
}

/**
 * Keep the evaluator headline and supporting detail tied to the same report.
 *
 * Gather classification, metric counts, and evidence limits after scoring pasted or uploaded Markdown.
 * Both banner helpers must use these same signals to explain the user's next review decision.
 */
interface EvaluatorVerdictSignals {
  report: SkillEvaluateResult;
  detected: string;
  detectedShape: string;
  shapeConfidence: number;
  shapeMismatch: boolean;
  failCount: number;
  warnCount: number;
  evidenceLimitNotes: string[];
  isHardVerdict: boolean;
  classificationConfidence: number;
}

// The action each recommendation asks the user to take, phrased for the banner sentence.
const EVALUATOR_RECOMMENDATION_LABELS: Record<string, string> = {
  "needs-human-review": "Manual review required",
  "consider-reclassifying": "Consider reclassifying",
  "consider-revision": "Revise before shipping",
  retire: "Retire or rewrite",
  "reference-playbook": "Ship as a reference",
  "keep-skill": "Keep as a skill",
};

/**
 * Choose the evaluator's next-action headline; packaging and classification mismatches take priority over metric counts.
 *
 * @param signals - report findings shared with the banner detail; empty evidence notes add no partial-read warning
 * @returns a non-empty headline describing the strongest review signal
 */
function evaluatorVerdictTitle(signals: EvaluatorVerdictSignals): string {
  // Strong shape mismatch tells the user the artifact may be packaged as the wrong thing.
  if (signals.shapeMismatch && signals.shapeConfidence >= 0.7) {
    const packagedAs =
      signals.report.artifact.kind === "skill" ? "skill" : "reference";
    return `Packaged as ${packagedAs}, reads like ${signals.detectedShape}`;
  }
  // High-confidence subtype mismatch is shown before metric counts because it changes next action.
  if (
    signals.classificationConfidence >= 0.85 &&
    signals.detected !== signals.report.subtype
  ) {
    return `This reads as a ${signals.detected}, not a ${signals.report.subtype}`;
  }
  // Failing metrics mean the user needs a stronger verdict than warning copy.
  if (signals.failCount > 0) {
    const verdictAction = signals.isHardVerdict
      ? "block ship"
      : "- needs review before keeping";
    return `${signals.failCount} failing metric${signals.failCount > 1 ? "s" : ""} ${verdictAction}`;
  }
  // Warnings are non-blocking, so the banner keeps the artifact reviewable.
  if (signals.warnCount > 0) {
    return `${signals.warnCount} non-blocking warning${signals.warnCount > 1 ? "s" : ""}`;
  }
  // Every metric passed, but only across the part of the artifact that was actually read.
  if (signals.evidenceLimitNotes.length > 0) {
    return "Assessment used partial evidence";
  }
  return "All structural metrics passing";
}

/**
 * Explain the confidence or metric count behind the evaluator headline so users can judge the suggested next action.
 *
 * @param signals - the same report findings used to choose the headline
 * @returns supporting text without its final full stop; zero non-passing metrics means no metric needs attention
 */
function evaluatorVerdictDetail(signals: EvaluatorVerdictSignals): string {
  // A packaging warning needs its confidence beside the headline so users can judge whether to reclassify.
  if (signals.shapeMismatch && signals.shapeConfidence >= 0.7) {
    return `${Math.round(signals.shapeConfidence * 100)}% shape confidence`;
  }
  // A subtype warning uses the same confidence threshold as the headline above it.
  if (
    signals.classificationConfidence >= 0.85 &&
    signals.detected !== signals.report.subtype
  ) {
    return `${Math.round(signals.classificationConfidence * 100)}% ${signals.detected} classification`;
  }
  const nonPassingCount = signals.failCount + signals.warnCount;
  return `${nonPassingCount} non-passing metric${nonPassingCount === 1 ? "" : "s"}`;
}

/**
 * Build the selected skill's status banner above its metric breakdown.
 *
 * @param appContext - dashboard app context; missing score helpers would prevent percentage-based warning copy
 * @param report - selected report; `null` means no skill report is ready to summarize
 * @returns banner text and severity; an absent report gives empty text and a warning placeholder
 */
function dashboardSkillSummaryBanner(
  appContext: DashboardAppContext,
  report: SkillQualityReport | null,
): SkillSummaryBanner {
  // No report is selected yet, so the Skills tab keeps the headline placeholder neutral.
  if (!report) return { title: "", desc: "", severity: "warn" };
  const scoreRatio = appContext.skillReportPct(report);
  const evidenceLimitNotes = dashboardSkillEvidenceLimitNotes(report);
  // Complete evidence adds no cautionary sentence to the banner.
  const evidenceLimitSuffix =
    evidenceLimitNotes.length > 0
      ? ` Evidence limit: ${evidenceLimitNotes.join("; ")}.`
      : "";
  // Warning count tells the user how much non-blocking cleanup remains.
  const warnCount = report.metrics.filter(
    (metric) => metric.severity === "warn",
  ).length;
  // Failure count takes precedence because blocking skill issues need the strongest banner.
  const failCount = report.metrics.filter(
    (metric) => metric.severity === "fail",
  ).length;
  const recommendation = report.recommendation;
  // Failing metrics mean the user should address structural issues before trusting the skill.
  if (failCount > 0) {
    // A failing report mentions warnings only when there is additional cleanup to review.
    const warningSummary = warnCount
      ? ` and ${warnCount} warning${warnCount > 1 ? "s" : ""}`
      : "";
    return {
      title: "Critical structural issues require attention",
      desc: `${failCount} failing metric${failCount > 1 ? "s" : ""}${warningSummary}. Recommended: ${recommendation}.${evidenceLimitSuffix}`,
      severity: "fail",
    };
  }
  // Warnings mean the skill can stay visible but still needs cleanup guidance.
  if (warnCount > 0) {
    const title =
      scoreRatio >= 0.85
        ? "Strong skill identity with adequate structural quality"
        : "Acceptable skill with non-blocking issues";
    return {
      title,
      desc: `${warnCount} non-blocking issue${
        warnCount > 1 ? "s" : ""
      }. Recommended: ${recommendation}, address warnings.${evidenceLimitSuffix}`,
      severity: "warn",
    };
  }
  // A bounded partial read can leave every observed metric green, but it is not a complete clean bill.
  if (evidenceLimitNotes.length > 0) {
    return {
      title: "Assessment used partial evidence",
      desc: `Evidence limit: ${evidenceLimitNotes.join(
        "; ",
      )}. Structural metrics only describe the content assessed. Recommended: ${recommendation}.`,
      severity: "warn",
    };
  }
  return {
    title: "All structural metrics passing",
    desc: `Recommended: ${recommendation}.`,
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
     * Open a skill after the user selects it, reusing cached scores when available.
     * Report failures as toasts; a late response cannot replace another project, runner, or skill selection.
     *
     * @param artifactId - selected inventory item's id, used as the cache key and scoring request parameter
     * @returns nothing; an uncached request clears the old report before loading, and reports failures through a toast
     */
    async loadSkillQualityReport(artifactId: string) {
      this.skillQualitySelectedId = artifactId;
      const cachedReport = this.skillQualityReports[artifactId];
      // Cached reports open instantly so users can switch back without another network wait.
      if (cachedReport) {
        this.skillQualityReport = cachedReport;
        this.skillQualityLoading = false;
        return;
      }
      // Selecting another uncached skill cancels the previous request; the first selection has nothing to cancel.
      this.skillQualityAbortController?.abort();
      const controller = new AbortController();
      this.skillQualityAbortController = controller;
      const requestProjectPath = this.projectPath;
      const requestRunner = this.activeRunner;
      this.skillQualityReport = null;
      this.skillQualityLoading = true;
      try {
        const response = await dashboardFetch(
          `/api/skill-quality?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestRunner)}&artifact=${encodeURIComponent(artifactId)}`,
          { signal: controller.signal },
        );
        const payload: unknown = await response.json();
        const error = readErrorMessage(
          readRecord(payload, "Skill quality report"),
        );
        // Scoring errors leave the cleared report panel empty and tell the user why through a toast.
        if (error) {
          this.showToast(error, true);
        } else if (
          // Only the report for the still-selected project, runner, and skill belongs in this panel.
          this.projectPath === requestProjectPath &&
          this.activeRunner === requestRunner &&
          this.skillQualitySelectedId === artifactId
        ) {
          const report = payload as SkillQualityReport; // -- The same-origin scoring route owns the report; object and error checks ran above.
          this.skillQualityReport = report;
          this.skillQualityReports[artifactId] = report;
        }
      } catch (failure) {
        // A failed fetch or invalid JSON response shows a scoring-error toast; a cancelled request stays silent.
        // Switching skills or leaving the view can cancel the request before it finishes.
        if (controller.signal.aborted) return;
        const errorMessage =
          failure instanceof Error ? failure.message : String(failure);
        this.showToast(errorMessage || "Skill quality scoring failed", true);
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
     * Count cached skills with warnings, failures, or incomplete evidence for the Skills tab's attention count.
     *
     * @returns the number needing review; zero means no cached report has one of these issues
     */
    skillsWithWarningsCount(): number {
      let warningCount = 0;
      // Scan cached reports in the same set the user sees in the Skills tab.
      for (const artifactId in this.skillQualityReports) {
        const report = this.skillQualityReports[artifactId];
        // Missing cache entries mean that skill has not produced a visible report yet.
        if (!report) continue;
        // Any warn/fail metric or bounded evidence surface makes this skill count as needing review.
        if (
          report.metrics.some(
            (metric: SkillQualityMetric) =>
              metric.severity === "warn" || metric.severity === "fail",
          ) ||
          dashboardSkillEvidenceLimitNotes(report).length > 0
        )
          warningCount++;
      }
      return warningCount;
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
      let scoreRatioTotal = 0;
      // Each cached report contributes the same normalized score to the rollup.
      for (const report of reports)
        scoreRatioTotal += Number(this.skillReportPct(report));
      return scoreRatioTotal / reports.length;
    },

    /**
     * Show the selected skill's strongest finding above its score so a high percentage cannot hide a failure.
     *
     * @param report - selected skill report; `null` means the Skills tab has no headline yet
     * @returns banner text and severity; an absent report gives empty text and a warning placeholder
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
      const classification = report.classification;
      const detected = classification.detectedSubtype;
      // Reports without separate shape fields use subtype classification to keep the verdict readable.
      const detectedShape = report.detectedShape ?? detected;
      const shapeConfidence =
        report.shapeConfidence ?? classification.confidence;
      const shapeMismatch =
        report.shapeMismatch ?? detectedShape !== report.subtype;
      const failCount = report.metrics.filter(
        (metric) => metric.severity === "fail",
      ).length;
      const warnCount = report.metrics.filter(
        (metric) => metric.severity === "warn",
      ).length;
      const evidenceLimitNotes = dashboardSkillEvidenceLimitNotes(report);
      const isHardVerdict =
        report.recommendation === "retire" ||
        report.recommendation === "consider-revision";
      const signals: EvaluatorVerdictSignals = {
        report,
        detected,
        detectedShape,
        shapeConfidence,
        shapeMismatch,
        failCount,
        warnCount,
        evidenceLimitNotes,
        isHardVerdict,
        classificationConfidence: classification.confidence,
      };
      // Complete input needs no partial-evidence caveat beneath the verdict.
      const evidenceLimitDetail =
        evidenceLimitNotes.length > 0
          ? ` Evidence limit: ${evidenceLimitNotes.join("; ")}.`
          : "";
      // An unfamiliar recommendation still gives the user a readable action in the banner.
      const recommendationLabel =
        EVALUATOR_RECOMMENDATION_LABELS[report.recommendation] ??
        "Keep as a skill";
      return {
        title: evaluatorVerdictTitle(signals),
        desc: `${evaluatorVerdictDetail(signals)}.${evidenceLimitDetail} ${recommendationLabel} before deciding to keep, convert, or discard.`,
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
        // The first tip creates its metric's advice group; later tips appear in the same group.
        const metricTips = tipsByMetric.get(tip.metric) ?? [];
        metricTips.push(tip);
        tipsByMetric.set(tip.metric, metricTips);
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
  };
}

/**
 * Add file roles, audit age, export labels, and tip toggles to the evaluator result panel.
 *
 * @returns dashboard fragment merged into the app alongside the result fragment
 */
function dashboardSkillEvaluatorLabelsFragment(): DashboardAppFragment {
  return {
    /**
     * Expand or collapse advice when the user selects a metric's tip group.
     *
     * @param metric - report metric id used to store that group's open or closed state
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
      const auditedAtMs = this.skillQualityAuditedAt;
      // Missing timestamp still tells the user the current data came from a recent audit.
      if (!auditedAtMs) return "audited recently";
      const elapsedMs = Date.now() - auditedAtMs;
      // Very fresh audits should read as immediate instead of "0 mins".
      if (elapsedMs < 60_000) return "audited just now";
      const elapsedMinutes = Math.floor(elapsedMs / 60_000);
      // Recent audits fit better in the compact scope strip as minutes.
      if (elapsedMinutes < 60)
        return `audited ${elapsedMinutes} min${elapsedMinutes > 1 ? "s" : ""} ago`;
      const elapsedHours = Math.floor(elapsedMinutes / 60);
      return `audited ${elapsedHours} hr${elapsedHours > 1 ? "s" : ""} ago`;
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
      // An unnamed artifact uses 'skill' in the copyable label before filename-unsafe characters are removed.
      const artifactSlug = (report.artifact.name || "skill")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return `evaluation-${today}-${artifactSlug}`;
    },
  };
}

/**
 * Add Copy report to the evaluator result panel; its handler reports clipboard failures through a toast.
 *
 * @returns the copy handler and its success-badge lifecycle for the dashboard app
 */
function dashboardSkillEvaluatorClipboardFragment(): DashboardAppFragment {
  return {
    /**
     * Copy the visible evaluator result as Markdown for a review note or PR.
     * The handler reports failures as toasts and clears any previous copy-success badge.
     *
     * @returns nothing; missing result leaves the clipboard unchanged
     */
    async copySkillEvaluatorReport() {
      const result = this.skillEvaluatorResult;
      // No result is visible yet, so copying would give the user stale or empty text.
      if (!result) return;
      const markdown = buildEvaluatorReportMarkdown(this, result);
      try {
        const wasCopied = await this.copyTextToClipboard(markdown);
        // Clipboard failure means the user needs a visible error instead of a false success badge.
        if (!wasCopied) throw new Error("Clipboard write failed");
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
      } catch (failure) {
        // The browser can deny a clipboard write after Copy report; remove the success badge and show the failure in a toast.
        this.skillEvaluatorReportCopied = false;
        // Failed copy attempts should remove any previous success timer immediately.
        if (this._skillEvaluatorReportCopiedTimer) {
          clearTimeout(this._skillEvaluatorReportCopiedTimer);
          this._skillEvaluatorReportCopiedTimer = null;
        }
        const errorMessage =
          failure instanceof Error ? failure.message : String(failure);
        this.showToast(errorMessage || "Copy failed", true);
      }
    },
  };
}

/**
 * Add form resets and local-file selection to the evaluator before scoring.
 * File input reports read failures in the form while keeping files from earlier successful selections.
 *
 * @returns dashboard fragment merged into the app alongside the clipboard fragment
 */
function dashboardSkillEvaluatorInputActionsFragment(): DashboardAppFragment {
  return {
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
     * Read files chosen in the picker or dropped into the evaluator; accept Markdown extensions and Markdown or plain-text MIME types.
     * The handler reports read failures in the form and keeps previously loaded files.
     *
     * @param fileList - browser selection; an empty list or no accepted files shows a form error
     * @returns nothing; loaded files populate chips and may prefill the suggested artifact name
     */
    async _ingestSkillEvaluatorFiles(fileList: FileList | File[]) {
      // For example, a mixed-file drop keeps Markdown extensions and files the browser identifies as Markdown or plain text.
      const acceptedFiles = Array.from(fileList).filter(
        (file) =>
          file.name.endsWith(".md") ||
          file.name.endsWith(".markdown") ||
          file.type === "text/markdown" ||
          file.type === "text/plain",
      );
      // No valid files means the drop/input action did not give the evaluator anything to score.
      if (acceptedFiles.length === 0) {
        this.skillEvaluatorError =
          "Drop .md / .markdown files only (got 0 valid files).";
        return;
      }
      const pendingFileReads = acceptedFiles.map(
        // Read local text before scoring; choosing an empty text file still creates a chip with empty content.
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
        const loadedFiles = await Promise.all(pendingFileReads);
        const existingFileNames = new Set(
          this.skillEvaluatorFiles.map(
            (file: { name: string; content: string }) => file.name,
          ),
        );
        // Append the completed batch while keeping files loaded by earlier picker or drop actions.
        for (const loadedFile of loadedFiles) {
          // A name already present before this batch keeps its existing chip and content.
          if (existingFileNames.has(loadedFile.name)) continue;
          this.skillEvaluatorFiles.push(loadedFile);
        }
        // Empty suggested name uses the first loaded filename as a helpful default.
        if (!this.skillEvaluatorName && this.skillEvaluatorFiles[0]) {
          const firstFile = this.skillEvaluatorFiles[0];
          this.skillEvaluatorName = firstFile.name.replace(
            /\.(md|markdown)$/i,
            "",
          );
        }
        this.skillEvaluatorError = null;
      } catch (failure) {
        // A selected file can become unreadable before FileReader finishes; show its error and keep the previously loaded chips.
        this.skillEvaluatorError =
          failure instanceof Error ? failure.message : String(failure);
      }
    },

    /**
     * Read the local files selected in the evaluator's picker, then reset the picker so the same file can be chosen again.
     *
     * @param event - file-picker change event; an absent or empty file list leaves the current input unchanged
     * @returns nothing; selected files are read asynchronously
     */
    loadSkillEvaluatorFile(event: Event) {
      const input = event.target as HTMLInputElement;
      // Cancelled pickers leave the evaluator unchanged.
      if (!input.files || input.files.length === 0) return;
      void this._ingestSkillEvaluatorFiles(input.files);
      // Clearing the picker lets the user select the same file again and receive another change event.
      input.value = "";
    },

    /**
     * Highlight the evaluator dropzone as the user drags files over it.
     *
     * @param event - dropzone drag event; preventing its default permits the later drop action
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
      // Leaving the browser or losing the dropzone target gives no contained destination, so the highlight will clear.
      const nextDragTarget = event.relatedTarget as Node | null;
      const dropzone = event.currentTarget as Node | null;
      // Moving between children should keep the dropzone visibly active.
      if (dropzone && nextDragTarget && dropzone.contains(nextDragTarget))
        return;
      this.skillEvaluatorDragActive = false;
    },
  };
}
