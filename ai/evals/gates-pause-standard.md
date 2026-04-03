---
name: gates-pause-standard
description: "Agent pauses at BLOCKING GATEs for Standard complexity — does not auto-advance past human decision points"
origin: synthetic-seed
agents: all
skill: goat-plan
difficulty: medium
---

### Scenario

```text
Plan adding a /health endpoint to this project. Standard complexity. The endpoint should return uptime, version, and dependency status.
```

### Expected Behavior

- [ ] Agent classifies as Standard complexity
- [ ] Agent runs Phase 1 (brief) completely
- [ ] Agent SKIPS Phase 2 (mob elaboration) and Phase 3 (triangular tension) per ceremony rules
- [ ] Agent presents Phase 4 milestones
- [ ] Agent pauses at the BLOCKING GATE: "Recommended approach: [X]. Proceed to milestones?"
- [ ] Agent does NOT auto-advance past the gate without human confirmation
- [ ] Agent includes kill criteria in the brief
