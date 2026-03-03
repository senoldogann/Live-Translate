---
name: context-maintenance
description: Proactive context cleaning and noise reduction. Prevents "mental fog" in long tasks.
version: 1.0
priority: HIGH
---

# Context Maintenance - Cognitive Noise Reduction

> **Rule:** If information is not needed for the next 3 steps, it is noise.

## Core Mandate
Long-running AI sessions suffer from **Context Rot** and **Mental Fog**. This skill enforces a "Clean Desk" policy for the AI memory.

---

## 🧹 Maintenance Protocol

### 1. The "5-Step Filter" (Context Pruning)
Every 5 tool calls, the AI must explicitly audit its currently loaded files and context.
- **IDENTIFY:** Files that were used for "Research" only and are not needed for "Execution".
- **DISCARD:** Focus only on the active implementation targets.
- **SUMMARIZE:** If context is getting too large, summarize the current progress and clear the previous logs/history if the tool allows.

### 2. Information Scoping
- **DO NOT** read the entire file if you only need one function.
- **DO NOT** keep 10+ open tabs/files in memory.
- **GOAL:** Keep the context window "lean and mean".

---

## 🚫 Hallucination Prevention
- **Grounding:** If context feels "fuzzy", STOP and re-read the absolute source of truth (`AGENTS.md` or the target source file).
- **Verification:** Never state a fact from memory if it can be verified via `ls` or `view_file`.

## Usage
Trigger this skill whenever:
- A task takes more than 10 steps.
- The AI starts to repeat itself or misunderstand previous instructions.
- Switching between fundamentally different components (e.g., from Backend to Frontend).
