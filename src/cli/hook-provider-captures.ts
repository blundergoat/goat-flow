/**
 * Retains reviewed Windows and WSL delivery observations for the 1.19.0 runtime.
 * Use these host-specific records when reviewing capture applicability; registry gates remain separate.
 * Digests preserve capture provenance without publishing transcripts or raw payload values.
 */
import type { HookProviderHostEvidence } from "./hook-contracts.js";

/** Reviewed observations, including incomplete rows that must not become support claims. */
export const HOOK_PROVIDER_HOST_EVIDENCE: readonly HookProviderHostEvidence[] =
  [
    {
      caseId: "C1",
      host: "windows",
      provider: "claude",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "The provider changed from Opus 5.5 to Opus 4.8 after the initial controls.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C2",
      host: "windows",
      provider: "claude",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C3",
      host: "windows",
      provider: "claude",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C4",
      host: "windows",
      provider: "codex",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C5",
      host: "windows",
      provider: "codex",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C6",
      host: "windows",
      provider: "codex",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C7",
      host: "windows",
      provider: "copilot",
      canonicalEvent: "pre-tool",
      providerEventName: "preToolUse",
      verification: "incomplete",
      summary:
        "Open by user decision: the earlier Windows run denied the harmless PowerShell control and did not expose the Git policy reason. No complete capture covers the current runtime.",
      limitations: [
        "The older partial run cannot establish current-runtime support.",
      ],
    },
    {
      caseId: "C8",
      host: "windows",
      provider: "copilot",
      canonicalEvent: "post-tool",
      providerEventName: "postToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C9",
      host: "windows",
      provider: "antigravity",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "security-hold",
      summary:
        "Security hold: the Windows launcher was quarantined as Trojan:Win32/Cloxer. No current complete capture is available.",
      limitations: [
        "No Windows launcher access, rebuild, restore or security-setting change is authorized.",
      ],
    },
    {
      caseId: "C10",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "The controller closed the client after its final response; natural provider exit is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C11",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C12",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C13",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "The JSONL does not expose actual model identity.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C14",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C15",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C16",
      host: "wsl",
      provider: "copilot",
      canonicalEvent: "pre-tool",
      providerEventName: "preToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Automatic Sonnet 5.5 to Sonnet 5 fallback; native model labels disagree; two file views were batched. These variances were explicitly accepted.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C17",
      host: "wsl",
      provider: "copilot",
      canonicalEvent: "post-tool",
      providerEventName: "postToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
    {
      caseId: "C18",
      host: "wsl",
      provider: "antigravity",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Earlier delivery was observed on superseded runtime bytes; a fresh capture is required.",
      limitations: [
        "The shared native PowerShell policy changed; the earlier capture is historical and a fresh capture is required.",
        "Actual model identity is limited to the native display and an unmapped but consistent enum.",
        "The controller closed the client after idle; the recorded exit is code 0 with signal 9, not natural process completion.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
    },
  ];
