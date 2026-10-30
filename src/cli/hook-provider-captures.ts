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
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The capture ended on its controller timeout after every required record was in the transcript; the user accepted this variance.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.312",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T09:33:20.193Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "635a71f979047dbdb67e9072d47f720e565b136fa00aefc592ef2c52c4e9f19c",
        approvalPacketSha256:
          "ebd2b5874ea044795a2c16930a745cb9dd4937337bad78fba5c6c060ab77de55",
        producer: "claude native session output",
        reviewSha256:
          "eb6ec6f1e2276b29f42f017c3021598f34db1c96388ece99edf2b77715efe2b5",
        runtimeSha256: {
          "antigravity-hook-bootstrap.cjs":
            "0e21ac9851c8b3ae0e6230ae2945415655333b9cde1644777dfd97c64084edb1",
          "deny-dangerous.mjs":
            "b9850695cfb2452819cc7297187b40672626c70af1021f32ab1c2f4933906300",
          "deny-dangerous/corpus.json":
            "df94a44ef1e348ccbc7e075acc938b97fec14241dcb074e555c932d69a440f8b",
          "deny-dangerous/git-command.mjs":
            "37716efd4c5e3da806862d195bfb581b989f664351fbe91aa244f27839c2bbaf",
          "deny-dangerous/github-command.mjs":
            "9eb3c60c1080d05284f700e6c5096b92a73d07ce6daf8c9b901ed9e76b6df12c",
          "deny-dangerous/patterns-paths.mjs":
            "62b186f72be1670534f3c7ed5573bf380ce68aa046a40adb8dcb10926fb99d70",
          "deny-dangerous/patterns-shell.mjs":
            "5a804affd0823bb8dfed986831e9283f46323bece0f66675a8e409a8b8127a56",
          "deny-dangerous/patterns-writes.mjs":
            "a934238c065dc558377b9ca429393fd1908cc3ec1336a8746cfbd62bb75c19c4",
          "deny-git-mutations.mjs":
            "806524a09fd0dd8ac63526b64ac7f469f129226a56f7a807f038736aa399bc04",
          "gh-graphql-read.cjs":
            "b0d4e01b1b13fba8a66c11fe5f0f13f996fec26deb7404efc7cd75337e5d13e6",
          "gruff-code-quality.mjs":
            "5956911b7d37ecc6def477011013760337c385df52d5f2481e2ae3e69119affe",
          "gruff/analyzer.mjs":
            "e936203fd20070779f5465435da2c8165e8bbaec7f80c404b276db0c62363af3",
          "gruff/feedback.mjs":
            "22017c552c66f9b548f6c170ff480af1e1df91ee6157fbbefd86dbee0e5aa6ec",
          "gruff/ranges.mjs":
            "8a8b88b9ebf9648886293513aefb6a0a27d90042ae42d88f2cb62e3cbe4c5355",
          "gruff/scope.mjs":
            "c5664c9db200f24d15dfff68b6ac7975ee0abf46367f7ce413dd5905605f88cd",
          "hook-launch-runtime.mjs":
            "da6d030dbfa13339759be909dab85b19eca8cc08da5ecd4065c66fe22f475666",
          "hook-launch.mjs":
            "4d5c1194e26402dec5958bfbea30b1c9bdf316d60af524561ee5625e00f0c2eb",
          "hook-output.mjs":
            "8fc7b94c560aab8c31222d1082374ad7b90a3477df955ec284e8916f95d72e63",
          "hook-policy-state.cjs":
            "e2cc779a13fead674083a4bcc9267d842d24f16aafcaceeddb0f2a88e2fcfc95",
          "hook-provider-adapters.mjs":
            "e197098ca2aae37b09bd2de5de8891b024af98a4896124b6fffc3ec2235374e6",
          "hook-supervisor.mjs":
            "9ece8d082ecc4f53540b6da919ef97a973649f3718e038996c1c46f40ed46bb2",
          "policy-corpus.mjs":
            "fedb14ab9f49f3ed526ed30ea80bf975e42a192043bdd977a47061b749a89fcd",
          "policy-evaluation.mjs":
            "a029818837765ccf1726206704986578f622e32fc99415cade5bb14d487750cc",
          "policy-git.mjs":
            "ae540d211f7309872dd20029c4f38dfc9f1774e4caeaf5ffe26334b54e1f422a",
          "policy-heredoc.mjs":
            "eeeddba44fc8cb1ce4e80619b03c7673e04f3422cbfa012ee531956efbf699d8",
          "policy-input.mjs":
            "533ff04a4660522c7781191fd4f7bd16a60631692ef8c971ff5426410ff00aee",
          "policy-prefixes.mjs":
            "31a464e0966601b21ec6638ae94968f60689b277d2207827eb922b8920ea5a21",
          "policy-segments.mjs":
            "b0408915ae823f061e65528ae2b8303c9bb1e72de054ab9e476ee52f97e4a580",
          "policy-substitutions.mjs":
            "373d4493db934621a91f6af73a5000b99eaa92990753f4d78db5742665e48b98",
          "policy-syntax.mjs":
            "e46c54a7881faa8d18721ec563cc81201f9773885ae6de2b3a2cd76b1d77541d",
          "policy-words.mjs":
            "51ecbfd923c722eb51b572fd818f2c55ae01ea6308d67f461a16481912bf8989",
          "post-turn-safety.mjs":
            "19698f19e87dafb450f0e034c468387a19b2b24ddabe17899a86fa167d4821f5",
          "post-turn/assignments.mjs":
            "d2ecb9410d52a3b50bbe9136f6c98373f34321eada4f4cc7c54a69816c3b64bd",
          "post-turn/context.mjs":
            "6f61e64607c08e5bf83c6fc63d2d4895920b528c2f81ca3622c4d76433f62ec2",
          "post-turn/controller.mjs":
            "d799e5277ad07ad50677a1ae9980c639bce728a4c8c87a3b2e563cf76296258a",
          "post-turn/recovery.mjs":
            "27eb1b162f6a34731e6ab489df8367a882e7f39889e05938b39154f73ab642a0",
          "post-turn/scanner.mjs":
            "95267f043bde4888508b25666801c4a5914a8e91f1510f1b908a1b563b0143d5",
          "process-tree.mjs":
            "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
          "run-hook.mjs":
            "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
          "vendor/graphql.cjs":
            "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
          "vendor/js-yaml.cjs":
            "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
        },
      },
    },
    {
      caseId: "C2",
      host: "windows",
      provider: "claude",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.312",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T09:38:02.316Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "189c8148ecb7f2d020a48df9dcf8127f54005afb521107d9fe1d6349e3830cab",
        approvalPacketSha256:
          "ebd2b5874ea044795a2c16930a745cb9dd4937337bad78fba5c6c060ab77de55",
        producer: "claude native session output",
        reviewSha256:
          "c69b2fcd525c7c8775fb1bd8e7840b94994f7a3982f292ed37617a018421a8ed",
        runtimeSha256: {
          "antigravity-hook-bootstrap.cjs":
            "0e21ac9851c8b3ae0e6230ae2945415655333b9cde1644777dfd97c64084edb1",
          "deny-dangerous.mjs":
            "b9850695cfb2452819cc7297187b40672626c70af1021f32ab1c2f4933906300",
          "deny-dangerous/corpus.json":
            "df94a44ef1e348ccbc7e075acc938b97fec14241dcb074e555c932d69a440f8b",
          "deny-dangerous/git-command.mjs":
            "37716efd4c5e3da806862d195bfb581b989f664351fbe91aa244f27839c2bbaf",
          "deny-dangerous/github-command.mjs":
            "9eb3c60c1080d05284f700e6c5096b92a73d07ce6daf8c9b901ed9e76b6df12c",
          "deny-dangerous/patterns-paths.mjs":
            "62b186f72be1670534f3c7ed5573bf380ce68aa046a40adb8dcb10926fb99d70",
          "deny-dangerous/patterns-shell.mjs":
            "5a804affd0823bb8dfed986831e9283f46323bece0f66675a8e409a8b8127a56",
          "deny-dangerous/patterns-writes.mjs":
            "a934238c065dc558377b9ca429393fd1908cc3ec1336a8746cfbd62bb75c19c4",
          "deny-git-mutations.mjs":
            "806524a09fd0dd8ac63526b64ac7f469f129226a56f7a807f038736aa399bc04",
          "gh-graphql-read.cjs":
            "b0d4e01b1b13fba8a66c11fe5f0f13f996fec26deb7404efc7cd75337e5d13e6",
          "gruff-code-quality.mjs":
            "5956911b7d37ecc6def477011013760337c385df52d5f2481e2ae3e69119affe",
          "gruff/analyzer.mjs":
            "e936203fd20070779f5465435da2c8165e8bbaec7f80c404b276db0c62363af3",
          "gruff/feedback.mjs":
            "22017c552c66f9b548f6c170ff480af1e1df91ee6157fbbefd86dbee0e5aa6ec",
          "gruff/ranges.mjs":
            "8a8b88b9ebf9648886293513aefb6a0a27d90042ae42d88f2cb62e3cbe4c5355",
          "gruff/scope.mjs":
            "c5664c9db200f24d15dfff68b6ac7975ee0abf46367f7ce413dd5905605f88cd",
          "hook-launch-runtime.mjs":
            "da6d030dbfa13339759be909dab85b19eca8cc08da5ecd4065c66fe22f475666",
          "hook-launch.mjs":
            "4d5c1194e26402dec5958bfbea30b1c9bdf316d60af524561ee5625e00f0c2eb",
          "hook-output.mjs":
            "8fc7b94c560aab8c31222d1082374ad7b90a3477df955ec284e8916f95d72e63",
          "hook-policy-state.cjs":
            "e2cc779a13fead674083a4bcc9267d842d24f16aafcaceeddb0f2a88e2fcfc95",
          "hook-provider-adapters.mjs":
            "e197098ca2aae37b09bd2de5de8891b024af98a4896124b6fffc3ec2235374e6",
          "hook-supervisor.mjs":
            "9ece8d082ecc4f53540b6da919ef97a973649f3718e038996c1c46f40ed46bb2",
          "policy-corpus.mjs":
            "fedb14ab9f49f3ed526ed30ea80bf975e42a192043bdd977a47061b749a89fcd",
          "policy-evaluation.mjs":
            "a029818837765ccf1726206704986578f622e32fc99415cade5bb14d487750cc",
          "policy-git.mjs":
            "ae540d211f7309872dd20029c4f38dfc9f1774e4caeaf5ffe26334b54e1f422a",
          "policy-heredoc.mjs":
            "eeeddba44fc8cb1ce4e80619b03c7673e04f3422cbfa012ee531956efbf699d8",
          "policy-input.mjs":
            "533ff04a4660522c7781191fd4f7bd16a60631692ef8c971ff5426410ff00aee",
          "policy-prefixes.mjs":
            "31a464e0966601b21ec6638ae94968f60689b277d2207827eb922b8920ea5a21",
          "policy-segments.mjs":
            "b0408915ae823f061e65528ae2b8303c9bb1e72de054ab9e476ee52f97e4a580",
          "policy-substitutions.mjs":
            "373d4493db934621a91f6af73a5000b99eaa92990753f4d78db5742665e48b98",
          "policy-syntax.mjs":
            "e46c54a7881faa8d18721ec563cc81201f9773885ae6de2b3a2cd76b1d77541d",
          "policy-words.mjs":
            "51ecbfd923c722eb51b572fd818f2c55ae01ea6308d67f461a16481912bf8989",
          "post-turn-safety.mjs":
            "19698f19e87dafb450f0e034c468387a19b2b24ddabe17899a86fa167d4821f5",
          "post-turn/assignments.mjs":
            "d2ecb9410d52a3b50bbe9136f6c98373f34321eada4f4cc7c54a69816c3b64bd",
          "post-turn/context.mjs":
            "6f61e64607c08e5bf83c6fc63d2d4895920b528c2f81ca3622c4d76433f62ec2",
          "post-turn/controller.mjs":
            "d799e5277ad07ad50677a1ae9980c639bce728a4c8c87a3b2e563cf76296258a",
          "post-turn/recovery.mjs":
            "27eb1b162f6a34731e6ab489df8367a882e7f39889e05938b39154f73ab642a0",
          "post-turn/scanner.mjs":
            "95267f043bde4888508b25666801c4a5914a8e91f1510f1b908a1b563b0143d5",
          "process-tree.mjs":
            "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
          "run-hook.mjs":
            "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
          "vendor/graphql.cjs":
            "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
          "vendor/js-yaml.cjs":
            "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
        },
      },
    },
    {
      caseId: "C3",
      host: "windows",
      provider: "claude",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "verified",
      summary:
        "Stop blocked a conflict marker, the model repaired it, and clean Stop completed.",
      limitations: [
        "The capture ended on its controller timeout after every required record was in the transcript; the user accepted this variance.",
        "Claude Code 2.1.312 recorded the Stop block in the stop summary's hook errors rather than a separate stop-feedback record.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.312",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T09:40:41.538Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "5e20f3ae181603bffdc03aea38a2a05814da7f5398e3c08cc6b13a990ee2af7a",
        approvalPacketSha256:
          "ebd2b5874ea044795a2c16930a745cb9dd4937337bad78fba5c6c060ab77de55",
        producer: "claude native session output",
        reviewSha256:
          "58be069ddf971a7c85f76dd0a4d151874944913764e4832915e9ca33efeddb91",
        runtimeSha256: {
          "antigravity-hook-bootstrap.cjs":
            "0e21ac9851c8b3ae0e6230ae2945415655333b9cde1644777dfd97c64084edb1",
          "deny-dangerous.mjs":
            "b9850695cfb2452819cc7297187b40672626c70af1021f32ab1c2f4933906300",
          "deny-dangerous/corpus.json":
            "df94a44ef1e348ccbc7e075acc938b97fec14241dcb074e555c932d69a440f8b",
          "deny-dangerous/git-command.mjs":
            "37716efd4c5e3da806862d195bfb581b989f664351fbe91aa244f27839c2bbaf",
          "deny-dangerous/github-command.mjs":
            "9eb3c60c1080d05284f700e6c5096b92a73d07ce6daf8c9b901ed9e76b6df12c",
          "deny-dangerous/patterns-paths.mjs":
            "62b186f72be1670534f3c7ed5573bf380ce68aa046a40adb8dcb10926fb99d70",
          "deny-dangerous/patterns-shell.mjs":
            "5a804affd0823bb8dfed986831e9283f46323bece0f66675a8e409a8b8127a56",
          "deny-dangerous/patterns-writes.mjs":
            "a934238c065dc558377b9ca429393fd1908cc3ec1336a8746cfbd62bb75c19c4",
          "deny-git-mutations.mjs":
            "806524a09fd0dd8ac63526b64ac7f469f129226a56f7a807f038736aa399bc04",
          "gh-graphql-read.cjs":
            "b0d4e01b1b13fba8a66c11fe5f0f13f996fec26deb7404efc7cd75337e5d13e6",
          "gruff-code-quality.mjs":
            "5956911b7d37ecc6def477011013760337c385df52d5f2481e2ae3e69119affe",
          "gruff/analyzer.mjs":
            "e936203fd20070779f5465435da2c8165e8bbaec7f80c404b276db0c62363af3",
          "gruff/feedback.mjs":
            "22017c552c66f9b548f6c170ff480af1e1df91ee6157fbbefd86dbee0e5aa6ec",
          "gruff/ranges.mjs":
            "8a8b88b9ebf9648886293513aefb6a0a27d90042ae42d88f2cb62e3cbe4c5355",
          "gruff/scope.mjs":
            "c5664c9db200f24d15dfff68b6ac7975ee0abf46367f7ce413dd5905605f88cd",
          "hook-launch-runtime.mjs":
            "da6d030dbfa13339759be909dab85b19eca8cc08da5ecd4065c66fe22f475666",
          "hook-launch.mjs":
            "4d5c1194e26402dec5958bfbea30b1c9bdf316d60af524561ee5625e00f0c2eb",
          "hook-output.mjs":
            "8fc7b94c560aab8c31222d1082374ad7b90a3477df955ec284e8916f95d72e63",
          "hook-policy-state.cjs":
            "e2cc779a13fead674083a4bcc9267d842d24f16aafcaceeddb0f2a88e2fcfc95",
          "hook-provider-adapters.mjs":
            "e197098ca2aae37b09bd2de5de8891b024af98a4896124b6fffc3ec2235374e6",
          "hook-supervisor.mjs":
            "9ece8d082ecc4f53540b6da919ef97a973649f3718e038996c1c46f40ed46bb2",
          "policy-corpus.mjs":
            "fedb14ab9f49f3ed526ed30ea80bf975e42a192043bdd977a47061b749a89fcd",
          "policy-evaluation.mjs":
            "a029818837765ccf1726206704986578f622e32fc99415cade5bb14d487750cc",
          "policy-git.mjs":
            "ae540d211f7309872dd20029c4f38dfc9f1774e4caeaf5ffe26334b54e1f422a",
          "policy-heredoc.mjs":
            "eeeddba44fc8cb1ce4e80619b03c7673e04f3422cbfa012ee531956efbf699d8",
          "policy-input.mjs":
            "533ff04a4660522c7781191fd4f7bd16a60631692ef8c971ff5426410ff00aee",
          "policy-prefixes.mjs":
            "31a464e0966601b21ec6638ae94968f60689b277d2207827eb922b8920ea5a21",
          "policy-segments.mjs":
            "b0408915ae823f061e65528ae2b8303c9bb1e72de054ab9e476ee52f97e4a580",
          "policy-substitutions.mjs":
            "373d4493db934621a91f6af73a5000b99eaa92990753f4d78db5742665e48b98",
          "policy-syntax.mjs":
            "e46c54a7881faa8d18721ec563cc81201f9773885ae6de2b3a2cd76b1d77541d",
          "policy-words.mjs":
            "51ecbfd923c722eb51b572fd818f2c55ae01ea6308d67f461a16481912bf8989",
          "post-turn-safety.mjs":
            "19698f19e87dafb450f0e034c468387a19b2b24ddabe17899a86fa167d4821f5",
          "post-turn/assignments.mjs":
            "d2ecb9410d52a3b50bbe9136f6c98373f34321eada4f4cc7c54a69816c3b64bd",
          "post-turn/context.mjs":
            "6f61e64607c08e5bf83c6fc63d2d4895920b528c2f81ca3622c4d76433f62ec2",
          "post-turn/controller.mjs":
            "d799e5277ad07ad50677a1ae9980c639bce728a4c8c87a3b2e563cf76296258a",
          "post-turn/recovery.mjs":
            "27eb1b162f6a34731e6ab489df8367a882e7f39889e05938b39154f73ab642a0",
          "post-turn/scanner.mjs":
            "95267f043bde4888508b25666801c4a5914a8e91f1510f1b908a1b563b0143d5",
          "process-tree.mjs":
            "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
          "run-hook.mjs":
            "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
          "vendor/graphql.cjs":
            "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
          "vendor/js-yaml.cjs":
            "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
        },
      },
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
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.0.103",
        providerMode:
          "prompt mode (-p), JSON output, low reasoning, allow-all-tools within available-tools",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T07:37:33.254Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "39678554b7b163573c4107bc92ec14aa62cab1f3b2022a2f4a41aa6eae4eaca7",
        approvalPacketSha256:
          "907d2687eebebef296b87d8e3e747fdc375755a76510862148a623a5e9f3af60",
        producer: "copilot native session output",
        reviewSha256:
          "0cb7088b11ef1b53ada6db634cbef82777f7693f93b9217de35a3bb1bc00c5e6",
        runtimeSha256: {
          "antigravity-hook-bootstrap.cjs":
            "0e21ac9851c8b3ae0e6230ae2945415655333b9cde1644777dfd97c64084edb1",
          "deny-dangerous.mjs":
            "b9850695cfb2452819cc7297187b40672626c70af1021f32ab1c2f4933906300",
          "deny-dangerous/corpus.json":
            "df94a44ef1e348ccbc7e075acc938b97fec14241dcb074e555c932d69a440f8b",
          "deny-dangerous/git-command.mjs":
            "37716efd4c5e3da806862d195bfb581b989f664351fbe91aa244f27839c2bbaf",
          "deny-dangerous/github-command.mjs":
            "9eb3c60c1080d05284f700e6c5096b92a73d07ce6daf8c9b901ed9e76b6df12c",
          "deny-dangerous/patterns-paths.mjs":
            "62b186f72be1670534f3c7ed5573bf380ce68aa046a40adb8dcb10926fb99d70",
          "deny-dangerous/patterns-shell.mjs":
            "5a804affd0823bb8dfed986831e9283f46323bece0f66675a8e409a8b8127a56",
          "deny-dangerous/patterns-writes.mjs":
            "a934238c065dc558377b9ca429393fd1908cc3ec1336a8746cfbd62bb75c19c4",
          "deny-git-mutations.mjs":
            "806524a09fd0dd8ac63526b64ac7f469f129226a56f7a807f038736aa399bc04",
          "gh-graphql-read.cjs":
            "b0d4e01b1b13fba8a66c11fe5f0f13f996fec26deb7404efc7cd75337e5d13e6",
          "gruff-code-quality.mjs":
            "5956911b7d37ecc6def477011013760337c385df52d5f2481e2ae3e69119affe",
          "gruff/analyzer.mjs":
            "e936203fd20070779f5465435da2c8165e8bbaec7f80c404b276db0c62363af3",
          "gruff/feedback.mjs":
            "22017c552c66f9b548f6c170ff480af1e1df91ee6157fbbefd86dbee0e5aa6ec",
          "gruff/ranges.mjs":
            "8a8b88b9ebf9648886293513aefb6a0a27d90042ae42d88f2cb62e3cbe4c5355",
          "gruff/scope.mjs":
            "c5664c9db200f24d15dfff68b6ac7975ee0abf46367f7ce413dd5905605f88cd",
          "hook-launch-runtime.mjs":
            "da6d030dbfa13339759be909dab85b19eca8cc08da5ecd4065c66fe22f475666",
          "hook-launch.mjs":
            "4d5c1194e26402dec5958bfbea30b1c9bdf316d60af524561ee5625e00f0c2eb",
          "hook-output.mjs":
            "8fc7b94c560aab8c31222d1082374ad7b90a3477df955ec284e8916f95d72e63",
          "hook-policy-state.cjs":
            "e2cc779a13fead674083a4bcc9267d842d24f16aafcaceeddb0f2a88e2fcfc95",
          "hook-provider-adapters.mjs":
            "e197098ca2aae37b09bd2de5de8891b024af98a4896124b6fffc3ec2235374e6",
          "hook-supervisor.mjs":
            "9ece8d082ecc4f53540b6da919ef97a973649f3718e038996c1c46f40ed46bb2",
          "policy-corpus.mjs":
            "fedb14ab9f49f3ed526ed30ea80bf975e42a192043bdd977a47061b749a89fcd",
          "policy-evaluation.mjs":
            "a029818837765ccf1726206704986578f622e32fc99415cade5bb14d487750cc",
          "policy-git.mjs":
            "ae540d211f7309872dd20029c4f38dfc9f1774e4caeaf5ffe26334b54e1f422a",
          "policy-heredoc.mjs":
            "eeeddba44fc8cb1ce4e80619b03c7673e04f3422cbfa012ee531956efbf699d8",
          "policy-input.mjs":
            "533ff04a4660522c7781191fd4f7bd16a60631692ef8c971ff5426410ff00aee",
          "policy-prefixes.mjs":
            "31a464e0966601b21ec6638ae94968f60689b277d2207827eb922b8920ea5a21",
          "policy-segments.mjs":
            "b0408915ae823f061e65528ae2b8303c9bb1e72de054ab9e476ee52f97e4a580",
          "policy-substitutions.mjs":
            "373d4493db934621a91f6af73a5000b99eaa92990753f4d78db5742665e48b98",
          "policy-syntax.mjs":
            "e46c54a7881faa8d18721ec563cc81201f9773885ae6de2b3a2cd76b1d77541d",
          "policy-words.mjs":
            "51ecbfd923c722eb51b572fd818f2c55ae01ea6308d67f461a16481912bf8989",
          "post-turn-safety.mjs":
            "19698f19e87dafb450f0e034c468387a19b2b24ddabe17899a86fa167d4821f5",
          "post-turn/assignments.mjs":
            "d2ecb9410d52a3b50bbe9136f6c98373f34321eada4f4cc7c54a69816c3b64bd",
          "post-turn/context.mjs":
            "6f61e64607c08e5bf83c6fc63d2d4895920b528c2f81ca3622c4d76433f62ec2",
          "post-turn/controller.mjs":
            "d799e5277ad07ad50677a1ae9980c639bce728a4c8c87a3b2e563cf76296258a",
          "post-turn/recovery.mjs":
            "27eb1b162f6a34731e6ab489df8367a882e7f39889e05938b39154f73ab642a0",
          "post-turn/scanner.mjs":
            "95267f043bde4888508b25666801c4a5914a8e91f1510f1b908a1b563b0143d5",
          "process-tree.mjs":
            "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
          "run-hook.mjs":
            "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
          "vendor/graphql.cjs":
            "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
          "vendor/js-yaml.cjs":
            "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
        },
      },
    },
    {
      caseId: "C8",
      host: "windows",
      provider: "copilot",
      canonicalEvent: "post-tool",
      providerEventName: "postToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.0.103",
        providerMode:
          "prompt mode (-p), JSON output, low reasoning, allow-all-tools within available-tools",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T07:38:38.730Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "2398efdd9d83c8d9e3e1446ac61b4eb95f26fa27fde3fd733b1cd4a8dd5dc3c0",
        approvalPacketSha256:
          "3b7997f9a531e7b935ebea1cf378c063a51f0507c6211feaa1bcbd63e1ee2e02",
        producer: "copilot native session output",
        reviewSha256:
          "4cdd5e06a830dc26813f8c9b77dd531bd64bd1eed2eb24a7e9ca5db43ce05ea9",
        runtimeSha256: {
          "antigravity-hook-bootstrap.cjs":
            "0e21ac9851c8b3ae0e6230ae2945415655333b9cde1644777dfd97c64084edb1",
          "deny-dangerous.mjs":
            "b9850695cfb2452819cc7297187b40672626c70af1021f32ab1c2f4933906300",
          "deny-dangerous/corpus.json":
            "df94a44ef1e348ccbc7e075acc938b97fec14241dcb074e555c932d69a440f8b",
          "deny-dangerous/git-command.mjs":
            "37716efd4c5e3da806862d195bfb581b989f664351fbe91aa244f27839c2bbaf",
          "deny-dangerous/github-command.mjs":
            "9eb3c60c1080d05284f700e6c5096b92a73d07ce6daf8c9b901ed9e76b6df12c",
          "deny-dangerous/patterns-paths.mjs":
            "62b186f72be1670534f3c7ed5573bf380ce68aa046a40adb8dcb10926fb99d70",
          "deny-dangerous/patterns-shell.mjs":
            "5a804affd0823bb8dfed986831e9283f46323bece0f66675a8e409a8b8127a56",
          "deny-dangerous/patterns-writes.mjs":
            "a934238c065dc558377b9ca429393fd1908cc3ec1336a8746cfbd62bb75c19c4",
          "deny-git-mutations.mjs":
            "806524a09fd0dd8ac63526b64ac7f469f129226a56f7a807f038736aa399bc04",
          "gh-graphql-read.cjs":
            "b0d4e01b1b13fba8a66c11fe5f0f13f996fec26deb7404efc7cd75337e5d13e6",
          "gruff-code-quality.mjs":
            "5956911b7d37ecc6def477011013760337c385df52d5f2481e2ae3e69119affe",
          "gruff/analyzer.mjs":
            "e936203fd20070779f5465435da2c8165e8bbaec7f80c404b276db0c62363af3",
          "gruff/feedback.mjs":
            "22017c552c66f9b548f6c170ff480af1e1df91ee6157fbbefd86dbee0e5aa6ec",
          "gruff/ranges.mjs":
            "8a8b88b9ebf9648886293513aefb6a0a27d90042ae42d88f2cb62e3cbe4c5355",
          "gruff/scope.mjs":
            "c5664c9db200f24d15dfff68b6ac7975ee0abf46367f7ce413dd5905605f88cd",
          "hook-launch-runtime.mjs":
            "da6d030dbfa13339759be909dab85b19eca8cc08da5ecd4065c66fe22f475666",
          "hook-launch.mjs":
            "4d5c1194e26402dec5958bfbea30b1c9bdf316d60af524561ee5625e00f0c2eb",
          "hook-output.mjs":
            "8fc7b94c560aab8c31222d1082374ad7b90a3477df955ec284e8916f95d72e63",
          "hook-policy-state.cjs":
            "e2cc779a13fead674083a4bcc9267d842d24f16aafcaceeddb0f2a88e2fcfc95",
          "hook-provider-adapters.mjs":
            "e197098ca2aae37b09bd2de5de8891b024af98a4896124b6fffc3ec2235374e6",
          "hook-supervisor.mjs":
            "9ece8d082ecc4f53540b6da919ef97a973649f3718e038996c1c46f40ed46bb2",
          "policy-corpus.mjs":
            "fedb14ab9f49f3ed526ed30ea80bf975e42a192043bdd977a47061b749a89fcd",
          "policy-evaluation.mjs":
            "a029818837765ccf1726206704986578f622e32fc99415cade5bb14d487750cc",
          "policy-git.mjs":
            "ae540d211f7309872dd20029c4f38dfc9f1774e4caeaf5ffe26334b54e1f422a",
          "policy-heredoc.mjs":
            "eeeddba44fc8cb1ce4e80619b03c7673e04f3422cbfa012ee531956efbf699d8",
          "policy-input.mjs":
            "533ff04a4660522c7781191fd4f7bd16a60631692ef8c971ff5426410ff00aee",
          "policy-prefixes.mjs":
            "31a464e0966601b21ec6638ae94968f60689b277d2207827eb922b8920ea5a21",
          "policy-segments.mjs":
            "b0408915ae823f061e65528ae2b8303c9bb1e72de054ab9e476ee52f97e4a580",
          "policy-substitutions.mjs":
            "373d4493db934621a91f6af73a5000b99eaa92990753f4d78db5742665e48b98",
          "policy-syntax.mjs":
            "e46c54a7881faa8d18721ec563cc81201f9773885ae6de2b3a2cd76b1d77541d",
          "policy-words.mjs":
            "51ecbfd923c722eb51b572fd818f2c55ae01ea6308d67f461a16481912bf8989",
          "post-turn-safety.mjs":
            "19698f19e87dafb450f0e034c468387a19b2b24ddabe17899a86fa167d4821f5",
          "post-turn/assignments.mjs":
            "d2ecb9410d52a3b50bbe9136f6c98373f34321eada4f4cc7c54a69816c3b64bd",
          "post-turn/context.mjs":
            "6f61e64607c08e5bf83c6fc63d2d4895920b528c2f81ca3622c4d76433f62ec2",
          "post-turn/controller.mjs":
            "d799e5277ad07ad50677a1ae9980c639bce728a4c8c87a3b2e563cf76296258a",
          "post-turn/recovery.mjs":
            "27eb1b162f6a34731e6ab489df8367a882e7f39889e05938b39154f73ab642a0",
          "post-turn/scanner.mjs":
            "95267f043bde4888508b25666801c4a5914a8e91f1510f1b908a1b563b0143d5",
          "process-tree.mjs":
            "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
          "run-hook.mjs":
            "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
          "vendor/graphql.cjs":
            "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
          "vendor/js-yaml.cjs":
            "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
        },
      },
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
