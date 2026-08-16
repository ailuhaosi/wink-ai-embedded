#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys

if sys.platform.startswith('win'):
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
WORKSPACE_DIR = os.path.abspath(os.path.join(DOCS_DIR, ".."))

LAYERS = ["decisions", "tech-designs", "implementation-plans", "reviews"]

def build_comprehensive_index():
    file_by_name = {}      # exact basename -> abs_path
    file_by_adr = {}       # "0016" -> abs_path
    file_by_date_prefix = {} # "2026-06-24-wink-micro-os-integrated-review" -> abs_path

    for root, dirs, files in os.walk(DOCS_DIR):
        for file in files:
            if file.endswith(".md"):
                abs_path = os.path.join(root, file)
                file_by_name[file] = abs_path

                # ADR ID matching (e.g., 0016-pal-...)
                adr_match = re.match(r"^(\d{4})-", file)
                if adr_match:
                    file_by_adr[adr_match.group(1)] = abs_path

                # Date/prefix matching
                prefix = os.path.splitext(file)[0]
                file_by_date_prefix[prefix] = abs_path

    return file_by_name, file_by_adr, file_by_date_prefix

def fix_all_path_occurrences(file_by_name, file_by_adr, file_by_date_prefix, apply=False):
    # Regex to catch any reference to docs/... or relative ../... to decisions/plans/reviews/tech-designs
    path_regex = re.compile(
        r'(\bfile:///[^\s\)]*docs/|\bdocs/|(?:\.\./)+)(decisions|tech-designs|implementation-plans|reviews)/([^\s\)\`"\'\]>]+)'
    )

    total_changes = 0
    changed_files = 0

    for root, dirs, files in os.walk(DOCS_DIR):
        for file in sorted(files):
            if not file.endswith(".md"):
                continue

            file_path = os.path.join(root, file)
            dir_of_file = os.path.dirname(file_path)

            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception as e:
                print(f"Warning: Could not read {file_path}: {e}")
                continue

            def replace_path(match):
                nonlocal total_changes
                prefix_str = match.group(1)   # e.g., "docs/", "../../", "file:///.../docs/"
                layer = match.group(2)        # decisions, tech-designs, implementation-plans, reviews
                rest_path = match.group(3)    # rest of path after layer, e.g. "2026-06-24-foo.md" or "archived/2026-q3/foo.md"

                # Strip trailing punctuation if matched by accident
                clean_rest = rest_path.rstrip(".,;:")
                anchor = ""
                if "#" in clean_rest:
                    clean_rest, anchor = clean_rest.split("#", 1)
                    anchor = "#" + anchor

                target_filename = os.path.basename(clean_rest)

                # Locate target file
                target_abs = None
                if target_filename in file_by_name:
                    target_abs = file_by_name[target_filename]
                else:
                    # Try matching ADR number (e.g., ADR-0016 or 0016)
                    adr_m = re.search(r'(\d{4})', target_filename)
                    if adr_m and adr_m.group(1) in file_by_adr:
                        target_abs = file_by_adr[adr_m.group(1)]
                    else:
                        # Try prefix matching
                        stem = os.path.splitext(target_filename)[0]
                        if stem in file_by_date_prefix:
                            target_abs = file_by_date_prefix[stem]

                if not target_abs or not os.path.exists(target_abs):
                    return match.group(0)

                # Reconstruct correct target path
                if prefix_str.startswith("docs/") or "docs/" in prefix_str:
                    # Workspace-relative path: docs/<layer>/<domain>/...
                    new_ws_rel = os.path.relpath(target_abs, WORKSPACE_DIR).replace("\\", "/")
                    if prefix_str.startswith("file:///"):
                        new_ws_rel = "file:///" + os.path.normpath(target_abs).replace("\\", "/")
                    new_str = new_ws_rel + anchor
                else:
                    # Markdown relative path: ../../<layer>/<domain>/...
                    new_rel = os.path.relpath(target_abs, dir_of_file).replace("\\", "/")
                    new_str = new_rel + anchor

                if new_str != (match.group(2) + "/" + rest_path) and new_str != match.group(0):
                    total_changes += 1
                    rel_src = os.path.relpath(file_path, DOCS_DIR).replace("\\", "/")
                    print(f"[{rel_src}] Replaced: {match.group(0)}  ===>  {new_str}")
                    return new_str

                return match.group(0)

            new_content = path_regex.sub(replace_path, content)
            if new_content != content:
                changed_files += 1
                if apply:
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(new_content)

    print(f"\nAudit finished. Total occurrences modified: {total_changes} across {changed_files} files.")

def main():
    apply_mode = "--apply" in sys.argv
    print(f"=== Deep Audit & Fix All Documentation Paths (Apply={apply_mode}) ===")
    file_by_name, file_by_adr, file_by_date_prefix = build_comprehensive_index()
    print(f"Indexed {len(file_by_name)} files, {len(file_by_adr)} ADRs.")
    fix_all_path_occurrences(file_by_name, file_by_adr, file_by_date_prefix, apply=apply_mode)

if __name__ == "__main__":
    main()
