#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import shutil
import re
import sys

# Try to force stdout/stderr to use UTF-8
if sys.platform.startswith('win'):
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))

DOMAINS = ["core", "tools", "frontend", "unisim"]
LAYERS = ["implementation-plans", "reviews"]

def flatten_layer(layer_name):
    layer_dir = os.path.join(DOCS_DIR, layer_name)
    if not os.path.exists(layer_dir):
        return

    for dom in DOMAINS:
        dom_dir = os.path.join(layer_dir, dom)
        if not os.path.exists(dom_dir):
            os.makedirs(dom_dir, exist_ok=True)
            continue

        # Collect all files and subdirectories inside active/ or archived/
        sub_items = os.listdir(dom_dir)
        for item in sub_items:
            item_path = os.path.join(dom_dir, item)
            if os.path.isdir(item_path) and item in ["active", "archived"]:
                for root, dirs, files in os.walk(item_path, topdown=False):
                    for file in files:
                        src = os.path.join(root, file)
                        rel_under_item = os.path.relpath(src, item_path)
                        parts = rel_under_item.split(os.sep)
                        if len(parts) > 1 and parts[0].startswith("2026-"):
                            rel_clean = os.path.join(*parts[1:])
                        else:
                            rel_clean = rel_under_item
                        
                        dst = os.path.join(dom_dir, rel_clean)
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        if src != dst:
                            if os.path.exists(dst):
                                if os.path.isdir(dst):
                                    shutil.rmtree(dst)
                                else:
                                    os.remove(dst)
                            print(f"[{layer_name}/{dom}] Flattening: {file} -> {os.path.relpath(dst, DOCS_DIR)}")
                            shutil.move(src, dst)
                            
                shutil.rmtree(item_path, ignore_errors=True)

def build_global_file_map():
    file_map = {}
    for root, dirs, files in os.walk(DOCS_DIR):
        for file in files:
            if file.endswith(".md"):
                file_path = os.path.join(root, file)
                file_map[file] = file_path
    return file_map

def fix_markdown_links(file_map):
    link_pattern = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
    fixed_count = 0

    for file_name, file_path in file_map.items():
        try:
            with open(file_path, "r", encoding="utf-8-sig") as f:
                content = f.read()
        except Exception as e:
            print(f"Warning: Failed to read {file_path}: {e}")
            continue

        def replace_link(match):
            nonlocal fixed_count
            label = match.group(1)
            target = match.group(2)

            if target.startswith(("http://", "https://", "mailto:", "#")):
                return match.group(0)

            target_path_part = target.split("#")[0]
            anchor_part = ("#" + target.split("#")[1]) if "#" in target else ""

            if not target_path_part.endswith(".md"):
                return match.group(0)

            dir_of_file = os.path.dirname(file_path)
            current_target_abs = os.path.normpath(os.path.join(dir_of_file, target_path_part))

            if os.path.exists(current_target_abs):
                return match.group(0)

            target_filename = os.path.basename(target_path_part)
            if target_filename in file_map:
                new_target_abs = file_map[target_filename]
                new_rel_path = os.path.relpath(new_target_abs, dir_of_file).replace("\\", "/")
                fixed_count += 1
                print(f"Fixed in {os.path.relpath(file_path, DOCS_DIR)}: {target_path_part} -> {new_rel_path}")
                return f"[{label}]({new_rel_path}{anchor_part})"

            return match.group(0)

        new_content = link_pattern.sub(replace_link, content)
        if new_content != content:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(new_content)

    print(f"Link healing finished. Total fixed links: {fixed_count}")

def main():
    print("=== Step 1: Flattening implementation-plans and reviews ===")
    for layer in LAYERS:
        flatten_layer(layer)
    
    print("\n=== Step 2: Indexing all Markdown files in docs/ ===")
    file_map = build_global_file_map()
    print(f"Indexed {len(file_map)} markdown files.")

    print("\n=== Step 3: Repairing Markdown relative links ===")
    fix_markdown_links(file_map)
    print("\n=== Flatten & Link Repair Complete! ===")

if __name__ == "__main__":
    main()
