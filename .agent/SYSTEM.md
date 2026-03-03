# 🧠 Maestro System Intelligence (2026 Agentic OS)

> **Single Source of Truth (SSoT)**
> Bu döküman, Maestro sisteminin beyni, haritası ve kullanım kılavuzudur. Diğer tüm araç dökümanları bu dosyadan beslenir.

---

## 🏗️ System Architecture & Codebase Map

### Directory Structure
```
.
├── AGENTS.md                # Master Constitution (SPAP v2.2 - Supreme Authority)
├── .agent/                  # Antigravity AI Engine
│   ├── SYSTEM.md            # THIS FILE (The Brain)
│   ├── agents/              # 16 Semantic Agent Personas
│   ├── skills/              # 62 Capability Modules
│   ├── workflows/           # BMAD step architecture
│   ├── rules/               # Constitutional Rules (GEMINI.md)
│   └── legacy/              # Backup of consolidated documents
├── scripts/                 # System automation & verification
└── [Project Files]          # Your actual source code
```

### Key Components
- **Agents (16):** Role-based personas from `project-planner` to `security-auditor`.
- **Skills (62):** Domain knowledge from `react-patterns` to `context-maintenance`.
- **Workflows:** Slash commands for automated procedures.

---

## 🚀 Usage & Quickstart Guide

### ⚡ Operational Modes
| Profile | Use Case | Activation |
|---------|----------|------------|
| **Lite** | 5-30 files, solo projects | `echo "MAESTRO_PROFILE=lite" > .maestro` |
| **Standard** | 30-100 files, small teams | Default |
| **Full** | 100+ files, enterprise | BMAD Workflows focus |

### 🛠️ Core Workflows
| Command | Mode | Purpose |
|---------|------|---------|
| `/create` | Implement | Fast feature development |
| `/brainstorm` | Planning | Socratic discovery & ideas |
| `/debug` | Debug | Root cause analysis |
| `/create-prd-v2` | Enterprise | BMAD Deep planning |

---

## 🛡️ Reliability & Self-Correction protocols

1. **Context Refresh Law:** AI must read `AGENTS.md` every 5 turns.
2. **Research-First:** No tech stack decisions without `web_search`.
3. **Hard Quality Gate:** `verify_all.py` must pass before task completion.
4. **Context Maintenance:** Active pruning of mental noise.

---

## 🔄 AI Provider Sync Protocol (Lean Mode)
Maestro is officially optimized for:
- **Codex CLI:** `.agents/skills` (Discovery)
- **OpenCode:** `opencode.json` (+ `.opencode/instructions/`)
- **Antigravity Engine:** Native `.agent/` integration

*Sync command:* `python3 scripts/sync_agents.py`

---
*Last Refactored: 2026-02-23 (The Great Consolidation)*
