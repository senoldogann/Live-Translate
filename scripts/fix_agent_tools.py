import os

agent_dir = ".agent/agents"
for filename in os.listdir(agent_dir):
    if filename.endswith(".md"):
        path = os.path.join(agent_dir, filename)
        with open(path, "r") as f:
            content = f.read()
        
        # Split by frontmatter delimiters
        parts = content.split("---")
        if len(parts) < 3:
            continue
            
        original_fm = parts[1]
        body = "---".join(parts[2:])
        
        # Extract known fields
        metadata = {}
        for line in original_fm.split("\n"):
            if ":" in line:
                key, val = line.split(":", 1)
                k = key.strip().lower()
                v = val.strip()
                # Clean value from previous corruption
                v = v.replace("true:", "").replace("true", "").strip()
                if v.startswith(":"): v = v[1:].strip()
                metadata[k] = v

        # Reconstruct exactly what we want
        new_fm = "---\n"
        # 1. Name & Description are essential
        if "name" in metadata: new_fm += f"name: {metadata['name']}\n"
        if "description" in metadata: new_fm += f"description: {metadata['description']}\n"
        
        # 2. Tools as Record (OpenCode preferred)
        new_fm += "tools:\n"
        for t in ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]:
            new_fm += f"  {t}: true\n"
            
        # 3. Model & Skills
        if "model" in metadata and metadata["model"]: 
            new_fm += f"model: {metadata['model']}\n"
        else:
            new_fm += "model: inherit\n"
            
        if "skills" in metadata: new_fm += f"skills: {metadata['skills']}\n"
        new_fm += "---\n"
        
        new_content = new_fm + body
        
        with open(path, "w") as f:
            f.write(new_content)
        print(f"✅ Cleanly rebuilt {filename}")

print("Reconstruction complete.")
