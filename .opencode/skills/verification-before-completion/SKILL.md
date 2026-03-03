# Skill: Verification Before Completion
Description: A mandatory gate function that enforces rigorous self-audit before task completion.

## 🎯 Goal
To eliminate "AI laziness" and ensure that every task is verified against reality, not just assumptions.

## 🛡️ The Gate Protocol
Before reporting ANY task as "Completed", you MUST run this mental (and technical) checklist:

### 1. Accuracy & Hallucination Check
- **Tool Output:** Did I actually run the tool, or did I assume what it would say? Check the last `terminal_output`.
- **File State:** Did I verify the file content after editing? Use `view_file` to confirm the changes are exactly as planned.
- **Broken Links:** If I added file links, do they point to existing files?

### 2. Sanitization (The "Pro" Standard)
- **Debugging Leftovers:** Remove `console.log`, `print()`, `var_dump()`, or any temporary debug comments.
- **Placeholder Cleanup:** Ensure no `TODO`, `FIXME`, or `// implementation goes here` remains in production-level code.

### 3. Edge Case Reflection
- **The "One Thing" Rule:** What is the one edge case that could break this change? (e.g., empty input, null values, 2026-specific date issues). Verify it.

## 🛑 Red Flags (DO NOT MARK COMPLETE IF...)
- [ ] You say: "I think it should work now."
- [ ] You say: "I've added the code, you can test it." (You should test it first!)
- [ ] There is a build error or a failing test in the background.

## 🏁 Definition of Done (DoD)
- Code is verified via terminal or browser.
- No debug leaks.
- All tier-specific rules (GEMINI.md) are followed.
- Evidence of success is provided to the user.
