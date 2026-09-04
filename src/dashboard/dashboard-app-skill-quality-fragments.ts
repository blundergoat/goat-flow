/**
 * Drive the Skills tab and Skill Evaluator UI.
 *
 * Use when a dashboard user reviews installed skill quality, opens one skill report, or evaluates pasted/dropped Markdown before deciding whether to
 * keep, revise, or retire an artifact.
 *
 * The helpers translate score payloads into badges, banners, clipboard summaries, and file input state without making the templates re-compute report
 * meaning.
 */

/**
 * The summary banner shown above the skill-quality breakdown: a title, supporting sentence, and one rolled-up severity.
 * `severity` is the worst metric severity present (fail beats warn beats pass), so the banner colour always reflects the most serious issue rather
 * than an average.
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
  if (!report) return [];
  return report.fitNotes.filter((note) =>
    /^(?:artifact|composition) truncated at\b/iu.test(note),
  );
}

/**
 * Render an evaluator result as the Markdown a user pastes into a PR, review note, or session summary.
 *
 * Section order and metric order both follow the visible panel, so the pasted text reads as the same assessment the
 * user was just looking at rather than a re-ordered summary of it.
 *
 * @param ctx - dashboard app context, used for the same grade, percentage, and slug helpers the panel displays
 * @param result - the evaluator result being exported; optional sections are omitted entirely rather than written
 *   as empty headings, because a bare "## Improvement tips" with nothing under it reads as advice that went missing
 * @returns the Markdown document; never empty
 */
function buildEvaluatorReportMarkdown(
  ctx: DashboardAppContext,
  result: SkillEvaluateResult,
): string {
  const lines: string[] = [];
  const pct = Math.round(ctx.skillReportPct(result) * 100);
  const grade = ctx.skillLetterGrade(ctx.skillReportPct(result));
  lines.push(`# ${result.artifact.name} - ${grade} ${pct}%`);
  lines.push(`Slug: \`${ctx.skillEvaluatorSlug(result)}\``);
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
    for (const src of result.composedFrom) {
      lines.push(`- ${src}`);
    }
  }
  return lines.join("\n");
}

/**
 * What the Skill Evaluator banner is written from, gathered once so the title and detail agree.
 * Collecting them in one shape is the contract that stops the headline saying one thing while the detail beneath it says another.
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

/** The action each recommendation asks the user to take, phrased for the banner sentence. */
const EVALUATOR_RECOMMENDATION_LABELS: Record<string, string> = {
  "needs-human-review": "Manual review required",
  "consider-reclassifying": "Consider reclassifying",
  "consider-revision": "Revise before shipping",
  retire: "Retire or rewrite",
  "reference-playbook": "Ship as a reference",
  "keep-skill": "Keep as a skill",
};

/**
 * Choose the single headline the evaluator banner leads with.
 *
 * The order is the point: a packaging or classification mismatch is shown ahead of metric counts, because it changes what
 * the user should do next rather than merely how good the artifact is.
 *
 * @param signals - the verdict signals read from the report
 * @returns the headline; never empty, so the banner always says something
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
    const tail = signals.isHardVerdict
      ? "block ship"
      : "- needs review before keeping";
    return `${signals.failCount} failing metric${signals.failCount > 1 ? "s" : ""} ${tail}`;
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
 * Build the supporting sentence under the banner headline, describing the same signal the headline chose.
 *
 * @param signals - the verdict signals read from the report
 * @returns the detail phrase, without its trailing full stop
 */
function evaluatorVerdictDetail(signals: EvaluatorVerdictSignals): string {
  if (signals.shapeMismatch && signals.shapeConfidence >= 0.7) {
    return `${Math.round(signals.shapeConfidence * 100)}% shape confidence`;
  }
  if (
    signals.classificationConfidence >= 0.85 &&
    signals.detected !== signals.report.subtype
  ) {
    return `${Math.round(signals.classificationConfidence * 100)}% ${signals.detected} classification`;
  }
  const nonPassing = signals.failCount + signals.warnCount;
  return `${nonPassing} non-passing metric${nonPassing === 1 ? "" : "s"}`;
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
  const evidenceLimitNotes = dashboardSkillEvidenceLimitNotes(report);
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
  const rec = report.recommendation;
  // Failing metrics mean the user should address structural issues before trusting the skill.
  if (failCount > 0) {
    const warningSummary = warnCount
      ? ` and ${warnCount} warning${warnCount > 1 ? "s" : ""}`
      : "";
    return {
      title: "Critical structural issues require attention",
      desc: `${failCount} failing metric${failCount > 1 ? "s" : ""}${warningSummary}. Recommended: ${rec}.${evidenceLimitSuffix}`,
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
      }. Recommended: ${rec}, address warnings.${evidenceLimitSuffix}`,
      severity: "warn",
    };
  }
  // A bounded partial read can leave every observed metric green, but it is not a complete clean bill.
  if (evidenceLimitNotes.length > 0) {
    return {
      title: "Assessment used partial evidence",
      desc: `Evidence limit: ${evidenceLimitNotes.join(
        "; ",
      )}. Structural metrics only describe the content assessed. Recommended: ${rec}.`,
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
     * @returns nothing; failures are reported as toasts and leave an uncached selection without a report
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
        const payload: unknown = await res.json();
        const error = readErrorMessage(
          readRecord(payload, "Skill quality report"),
        );
        // Server-side scoring errors become a toast instead of replacing the current report.
        if (error) {
          this.showToast(error, true);
          // The response still matches the visible project, runner, and selected skill.
        } else if (
          this.projectPath === requestProjectPath &&
          this.activeRunner === requestRunner &&
          this.skillQualitySelectedId === artifactId
        ) {
          const report = payload as SkillQualityReport; // -- The same-origin scoring route owns the report; object and error checks ran above.
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
     * @returns warning/failure/evidence-limit count; zero means every cached report is currently clean
     */
    skillsWithWarningsCount(): number {
      let count = 0;
      // Scan cached reports in the same set the user sees in the Skills tab.
      for (const id in this.skillQualityReports) {
        const report = this.skillQualityReports[id];
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
     *
     * The branch order promotes blocking findings above percentage score so a high score cannot hide a small number of load-bearing structural
     * failures because review must see the risk before the aggregate grade.
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
        classificationConfidence: cls.confidence,
      };
      const evidenceLimitDetail =
        evidenceLimitNotes.length > 0
          ? ` Evidence limit: ${evidenceLimitNotes.join("; ")}.`
          : "";
      const recHuman =
        EVALUATOR_RECOMMENDATION_LABELS[report.recommendation] ??
        "Keep as a skill";
      return {
        title: evaluatorVerdictTitle(signals),
        desc: `${evaluatorVerdictDetail(signals)}.${evidenceLimitDetail} ${recHuman} before deciding to keep, convert, or discard.`,
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
  };
}

/**
 * Build the Skill Evaluator's label and interaction methods: tip toggling, audit recency, file roles, and the export slug.
 *
 * These are the small pieces the result panel reads around the verdict, kept apart from the verdict and tip builders so
 * neither half becomes a wall of unrelated methods.
 *
 * @returns dashboard fragment merged into the app alongside the result fragment
 */
function dashboardSkillEvaluatorLabelsFragment(): DashboardAppFragment {
  return {
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
     * Clipboard failures are reported as toasts and clear any previous success badge.
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
  };
}

/**
 * Build the Skill Evaluator's form methods: resetting it, clearing a result, and taking dropped or chosen Markdown files.
 *
 * These are the actions that change what the evaluator is about to score, kept apart from the copy action that exports a
 * score already produced.
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
     * Read dropped or selected Markdown files into the Skill Evaluator.
     * Use after the user drops files or picks them from the file input.
     * Read failures are reported in the evaluator without discarding previously loaded files.
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
        for (const loadedFile of loaded) {
          // Duplicate filenames keep the existing chip and avoid ambiguous result rows.
          if (existing.has(loadedFile.name)) continue;
          this.skillEvaluatorFiles.push(loadedFile);
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
