import os

# Define the skills directory
SKILLS_DIR = ".agent/skills"
INDEX_FILE = os.path.join(SKILLS_DIR, "SKILL_INDEX.md")

print(f"Generating index for {SKILLS_DIR}...")

# Collect skills
skills = []
try:
    for item in os.listdir(SKILLS_DIR):
        skill_path = os.path.join(SKILLS_DIR, item)
        # Skip hidden files and non-directories
        if os.path.isdir(skill_path) and not item.startswith("."):
            desc = "No description found."
            skill_md = os.path.join(skill_path, "SKILL.md")
            
            # Try to read description from SKILL.md
            if os.path.exists(skill_md):
                try:
                    with open(skill_md, "r", encoding="utf-8") as f:
                        content = f.read()
                        # Simple frontmatter parser
                        if content.startswith("---"):
                            parts = content.split("---", 2)
                            if len(parts) >= 3:
                                frontmatter = parts[1]
                                for line in frontmatter.split("\n"):
                                    if line.strip().startswith("description:"):
                                        desc = line.split(":", 1)[1].strip()
                                        break
                except Exception as e:
                    print(f"Warning: Could not read description for {item}: {e}")
            
            skills.append((item, desc))

    # Sort skills alphabetically
    skills.sort()

    # Write the index file
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        f.write("# 🧠 Agent Skills Index\n\n")
        f.write(f"> **Total Skills:** {len(skills)}\n\n")
        f.write("| Skill Name | Description |\n")
        f.write("|------------|-------------|\n")
        for name, desc in skills:
            # Escape pipes in description just in case
            safe_desc = desc.replace("|", "\|")
            f.write(f"| `{name}` | {safe_desc} |\n")

    print(f"✅ Automatically generated SKILL_INDEX.md with {len(skills)} skills at {INDEX_FILE}")

except Exception as e:
    print(f"❌ Failed to generate index: {e}")
