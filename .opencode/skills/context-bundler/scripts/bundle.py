import os
import argparse
import fnmatch
from datetime import datetime

# Configuration
IGNORE_PATTERNS = [
    '.git', '__pycache__', 'node_modules', '.DS_Store', 'dist', 'build', 
    'coverage', '*.pyc', '*.o', '*.exe', '*.dll', '*.so', '.env', 
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'gemini.db',
    'context_bundle.xml', 'context_bundle.md', 'vscode-system'
]

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.pdf', '.zip', '.tar', '.gz'}

def load_gitignore(root_dir):
    """Load .gitignore patterns if exists"""
    patterns = []
    gitignore_path = os.path.join(root_dir, '.gitignore')
    if os.path.exists(gitignore_path):
        with open(gitignore_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    patterns.append(line)
    return patterns

def should_ignore(path, root_dir, ignore_patterns):
    """Check if path should be ignored based on patterns"""
    name = os.path.basename(path)
    rel_path = os.path.relpath(path, root_dir)
    
    # Check default strict ignores first
    if name == '.git' or '.git/' in rel_path:
        return True

    for pattern in ignore_patterns + IGNORE_PATTERNS:
        if fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(rel_path, pattern):
            return True
        # Handle directory matches
        if pattern.endswith('/') and fnmatch.fnmatch(rel_path + '/', pattern):
            return True
            
    return False

def is_binary(file_path):
    """Check if file is binary or image"""
    _, ext = os.path.splitext(file_path)
    if ext.lower() in IMAGE_EXTENSIONS:
        return True
    return False

def generate_xml(files, root_dir):
    output = ['<codebase>']
    output.append(f'  <!-- Generated: {datetime.now().isoformat()} -->')
    output.append(f'  <!-- Root: {root_dir} -->')
    output.append(f'  <!-- Total Files: {len(files)} -->')
    
    for file_path in files:
        rel_path = os.path.relpath(file_path, root_dir)
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                
            output.append(f'  <file path="{rel_path}">')
            output.append(f'    <![CDATA[')
            output.append(content)
            output.append(f'    ]]>')
            output.append(f'  </file>')
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            
    output.append('</codebase>')
    return '\n'.join(output)

def generate_markdown(files, root_dir):
    output = [f"# Codebase Bundle ({datetime.now().isoformat()})"]
    output.append(f"Root: `{root_dir}`")
    output.append(f"Total Files: {len(files)}")
    output.append("\n---")
    
    for file_path in files:
        rel_path = os.path.relpath(file_path, root_dir)
        ext = os.path.splitext(file_path)[1].lstrip('.')
        if not ext: ext = 'txt'
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                
            output.append(f"\n## File: `{rel_path}`")
            output.append(f"```{ext}")
            output.append(content)
            output.append("```")
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            
    return '\n'.join(output)

def main():
    parser = argparse.ArgumentParser(description='Context Bundler')
    parser.add_argument('--dir', default='.', help='Root directory to bundle')
    parser.add_argument('--format', choices=['xml', 'markdown'], default='xml', help='Output format')
    parser.add_argument('--output', help='Output file path')
    
    args = parser.parse_args()
    
    root_dir = os.path.abspath(args.dir)
    git_ignores = load_gitignore(root_dir)
    
    collected_files = []
    
    print(f"Scanning {root_dir}...")
    
    for root, dirs, files in os.walk(root_dir):
        # Filter directories in-place
        dirs[:] = [d for d in dirs if not should_ignore(os.path.join(root, d), root_dir, git_ignores)]
        
        for file in files:
            file_path = os.path.join(root, file)
            if should_ignore(file_path, root_dir, git_ignores):
                continue
            if is_binary(file_path):
                continue
                
            collected_files.append(file_path)
            
    print(f"Found {len(collected_files)} files.")
    
    if args.format == 'xml':
        content = generate_xml(collected_files, root_dir)
        ext = 'xml'
    else:
        content = generate_markdown(collected_files, root_dir)
        ext = 'md'
        
    output_path = args.output or f"context_bundle.{ext}"
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Bundle created at: {output_path}")

if __name__ == '__main__':
    main()
