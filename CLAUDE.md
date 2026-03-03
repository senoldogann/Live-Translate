# 🤖 CLAUDE CODE CONFIGURATION (2026)

## ⚖️ Maestro Constitution
Refer to [AGENTS.md](file:///Users/dogan/Desktop/most-current-rules/AGENTS.md) for supreme authority and [SYSTEM.md](file:///Users/dogan/Desktop/most-current-rules/.agent/SYSTEM.md) for architectural maps.

## 👥 Maestro Agent Team
Claude can access specialized sub-agents located in `.claude/agents/`. Use them for domain-specific tasks:
- **Architect Agent:** For structural decisions.
- **Security Agent:** For vulnerability scans.
- **QA Agent:** For testing strategies.

## ⚡ Power Workflows (Slash Commands)
The following workflows are available in `.claude/workflows/`. You can invoke them or follow their steps:
- `/agent`: Create/Edit/Validate agents.
- `/dev-story`: Execute user stories.
- `/code-review`: Perform adversarial reviews.
- `/tech-writer`: Generate high-quality docs.

## 🛠️ Operational Standards
- **Sync First:** Always run `python3 scripts/sync_agents.py` before editing rules.
- **Verify Always:** Run `python3 scripts/verify_all.py` after code changes.
- **Lean Principle:** Stick to [Lean Mode] standards defined in SYSTEM.md.
