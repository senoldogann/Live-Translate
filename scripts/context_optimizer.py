#!/usr/bin/env python3
"""
Context Optimizer - Smart Rule Loading for Maestro
Reduces context window usage by loading only essential rules.
"""

def get_minimal_rules(workflow_type: str) -> list[str]:
    """
    Return only essential rule files for the given workflow type.
    
    Args:
        workflow_type: Type of workflow (prd, architecture, dev, etc.)
    
    Returns:
        List of absolute paths to essential rule files
    """
    
    base_dir = "/Users/dogan/Desktop/rules/.agent"
    
    # Always load these
    base_rules = [
        "AGENTS.md",  # Master constitution
        f"{base_dir}/rules/GEMINI.md",  # Global rules index
    ]
    
    # Workflow-specific rules
    workflow_rules = {
        "prd": [
            f"{base_dir}/rules/00-ARCHITECT-MANIFESTO.md",
            f"{base_dir}/skills/brainstorming/SKILL.md",
        ],
        "architecture": [
            f"{base_dir}/rules/00-ARCHITECT-MANIFESTO.md",
            f"{base_dir}/skills/architecture/SKILL.md",
            f"{base_dir}/skills/system-design/SKILL.md",
        ],
        "dev": [
            f"{base_dir}/rules/00-ARCHITECT-MANIFESTO.md",
            f"{base_dir}/skills/clean-code/SKILL.md",
            f"{base_dir}/skills/testing-patterns/SKILL.md",
            f"{base_dir}/skills/tdd-workflow/SKILL.md",
        ],
        "debug": [
            f"{base_dir}/skills/systematic-debugging/SKILL.md",
        ],
        "security": [
            f"{base_dir}/rules/50-security-and-testing.md",
            f"{base_dir}/skills/security-review/SKILL.md",
            f"{base_dir}/skills/vulnerability-scanner/SKILL.md",
        ],
    }
    
    # Combine base + workflow-specific
    rules = base_rules + workflow_rules.get(workflow_type, [])
    
    return rules


def generate_context_summary(step_name: str, decisions: dict, user_prefs: dict) -> str:
    """
    Generate compact context summary for checkpoint.
    
    Args:
        step_name: Current step identifier
        decisions: Technical decisions made
        user_prefs: User preferences captured
    
    Returns:
        Markdown formatted summary
    """
    
    summary = f"""
# Context Summary: {step_name}

## Key Decisions
"""
    
    for key, value in decisions.items():
        summary += f"- **{key}**: {value}\n"
    
    summary += "\n## User Preferences\n"
    
    for key, value in user_prefs.items():
        summary += f"- **{key}**: {value}\n"
    
    summary += "\n---\n*This summary helps maintain context across AI sessions.*\n"
    
    return summary


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python context_optimizer.py <workflow_type>")
        print("Example: python context_optimizer.py prd")
        sys.exit(1)
    
    workflow_type = sys.argv[1]
    rules = get_minimal_rules(workflow_type)
    
    print(f"Essential rules for '{workflow_type}' workflow:")
    for rule in rules:
        print(f"  - {rule}")
