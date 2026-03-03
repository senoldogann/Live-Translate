# Context Bundler Skill

> **Inspired by BMAD-METHOD** | "Codebase Flattener" for Deep Reasoning

## Overview

This skill provides a tool to **flatten your codebase** into a single, AI-consumable XML or Markdown file. This is critical for "Deep Reasoning" sessions where the Agent needs 100% of the relevant context in one prompt to solve complex architectural problems.

## Why Use This?
- **Global Context:** Give LLMs the "God View" of your project.
- **Token Efficiency:** Removes whitespace, comments (optional), and non-essential files.
- **Portability:** Moving context between different AI sessions.

## Usage

Run the bundler script to generate a `context_bundle.xml` or `context_bundle.md`.

```bash
# Default (XML output, respects .gitignore)
python .agent/skills/context-bundler/scripts/bundle.py

# specific directory
python .agent/skills/context-bundler/scripts/bundle.py --dir ./src

# Markdown format
python .agent/skills/context-bundler/scripts/bundle.py --format markdown
```

## Output Format (XML)

```xml
<codebase>
  <file path="src/main.py">
    <![CDATA[
    print("Hello World")
    ]]>
  </file>
  <file path="package.json">
    ...
  </file>
</codebase>
```

## Output Format (Markdown)

```markdown
# File: src/main.py
```python
print("Hello World")
```
...
```
