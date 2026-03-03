import os
import json
import re

"""
Maestro Agent Sync Engine (v1.0)
-------------------------------
Bu script, AGENTS.md ve .agent/SYSTEM.md dosyalarını baz alarak tüm AI araçlarının
(Cline, Kilocode, OpenCode, Codex, Copilot) kural ve dökümantasyon dosyalarını senkronize eder.
"""

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AGENTS_PATH = os.path.join(ROOT_DIR, "AGENTS.md")
SYSTEM_PATH = os.path.join(ROOT_DIR, ".agent", "SYSTEM.md")

def read_file(path):
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def sync():
    print("🔄 Maestro Sync Engine starting...")
    
    # 1. Load Master Content
    agents_md = read_file(AGENTS_PATH)
    system_md = read_file(SYSTEM_PATH)
    
    combined_instructions = f"""# MAESTRO MASTER INSTRUCTIONS
    
{agents_md}

---

{system_md}
"""

    # 2. Sync OpenCode (opencode.json + .opencode/instructions/)
    print("  - Syncing OpenCode...")
    oc_path = os.path.join(ROOT_DIR, "opencode.json")
    if os.path.exists(oc_path):
        with open(oc_path, "r") as f:
            config = json.load(f)
        
        # Update instructions to point to SSoT files
        config["instructions"] = [
            "AGENTS.md",
            ".agent/SYSTEM.md",
            ".agent/skills/SKILL_INDEX.md",
            ".agent/rules/100-tech-stack.md"
        ]
        write_file(oc_path, json.dumps(config, indent=4))
        
        # Ensure .opencode/instructions/ symlinks
        instr_dir = os.path.join(ROOT_DIR, ".opencode", "instructions")
        os.makedirs(instr_dir, exist_ok=True)
        try:
            if not os.path.exists(os.path.join(instr_dir, "AGENTS.md")):
                os.symlink("../../AGENTS.md", os.path.join(instr_dir, "AGENTS.md"))
            if not os.path.exists(os.path.join(instr_dir, "SKILL_INDEX.md")):
                os.symlink("../../.agent/skills/SKILL_INDEX.md", os.path.join(instr_dir, "SKILL_INDEX.md"))
        except:
            pass

    # 3. Sync Codex (.codex/config.toml)
    print("  - Syncing Codex (.codex/config.toml)...")
    codex_path = os.path.join(ROOT_DIR, ".codex", "config.toml")
    if os.path.exists(codex_path):
        content = read_file(codex_path)
        content = content.replace('"USAGE_GUIDE.md"', '".agent/SYSTEM.md"')
        write_file(codex_path, content)

    # 4. Sync Claude Code (.claude/rules/maestro-core.md)
    print("  - Syncing Claude Code...")
    claude_rule_path = os.path.join(ROOT_DIR, ".claude", "rules", "maestro-core.md")
    write_file(claude_rule_path, combined_instructions)

    # 5. Maintenance: Physical Skill & Agent & Workflow Sync (Codex & OpenCode & Claude)
    # Portability için symlink yerine fiziksel kopyalama tercih edildi (Ok işaretlerini kaldırır)
    print("  - Syncing Skills, Agents, and Workflows to Providers (Physical Copy)...")
    import shutil
    
    # Sync Targets Table
    # (Source Directory, List of Target Directories)
    sync_jobs = [
        (os.path.join(ROOT_DIR, ".agent", "skills"), [
            os.path.join(ROOT_DIR, ".agents", "skills"),
            os.path.join(ROOT_DIR, ".opencode", "skills"),
            os.path.join(ROOT_DIR, ".claude", "skills")
        ]),
        (os.path.join(ROOT_DIR, ".agent", "agents"), [
            os.path.join(ROOT_DIR, ".opencode", "agents"),
            os.path.join(ROOT_DIR, ".claude", "agents")
        ]),
        (os.path.join(ROOT_DIR, ".agent", "workflows"), [
            os.path.join(ROOT_DIR, ".claude", "workflows")
        ])
    ]
    
    for source, targets in sync_jobs:
        if not os.path.exists(source):
            continue
            
        for target in targets:
            try:
                if os.path.exists(target):
                    shutil.rmtree(target)
                
                shutil.copytree(source, target)
                print(f"    ✓ Synced {os.path.basename(source)} to {os.path.relpath(target, ROOT_DIR)}")
            except Exception as e:
                print(f"    ! Failed to sync {source} to {target}: {e}")

    print("✅ Sync COMPLETED successfully.")

if __name__ == "__main__":
    sync()
