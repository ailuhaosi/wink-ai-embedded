#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrate_design_paths.py

Migration tool to rewrite documentation paths:
- docs/design/ -> docs/zh/design/
- docs/tech-designs/ -> docs/zh/tech-designs/
- docs/product/ -> docs/zh/product/
- file:///.../docs/design/ -> file:///.../docs/zh/design/
- relative links from decisions/plans/reviews: ../../design/ -> ../../zh/design/
"""

import os
import re
import sys
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
WORKSPACE_DIR = os.path.abspath(os.path.join(DOCS_DIR, ".."))

# Replacements rules: (pattern, replacement_builder)
MIGRATION_PATTERNS = [
    # 1. Absolute file:/// URI with docs/design/
    (
        re.compile(r'file:///([^\s\)]*)/docs/design/([^\s\)]+)'),
        r'file:///\1/docs/zh/design/\2'
    ),
    (
        re.compile(r'file:///([^\s\)]*)/docs/tech-designs/([^\s\)]+)'),
        r'file:///\1/docs/zh/tech-designs/\2'
    ),
    (
        re.compile(r'file:///([^\s\)]*)/docs/product/([^\s\)]+)'),
        r'file:///\1/docs/zh/product/\2'
    ),
    # 2. Workspace text path: docs/design/ -> docs/zh/design/
    (
        re.compile(r'(?<![a-zA-Z0-9_\-\/])docs/design/([a-zA-Z0-9_\-\/\.]+)'),
        r'docs/zh/design/\1'
    ),
    (
        re.compile(r'(?<![a-zA-Z0-9_\-\/])docs/tech-designs/([a-zA-Z0-9_\-\/\.]+)'),
        r'docs/zh/tech-designs/\1'
    ),
    (
        re.compile(r'(?<![a-zA-Z0-9_\-\/])docs/product/([a-zA-Z0-9_\-\/\.]+)'),
        r'docs/zh/product/\1'
    ),
    # 3. Relative link from 2-deep subfolders (e.g. docs/decisions/core/): ../../design/ -> ../../zh/design/
    (
        re.compile(r'(\.\./\.\./)design/([a-zA-Z0-9_\-\/\.]+)'),
        r'\1zh/design/\2'
    ),
    (
        re.compile(r'(\.\./\.\./)tech-designs/([a-zA-Z0-9_\-\/\.]+)'),
        r'\1zh/tech-designs/\2'
    ),
    (
        re.compile(r'(\.\./\.\./)product/([a-zA-Z0-9_\-\/\.]+)'),
        r'\1zh/product/\2'
    ),
    # 4. Relative link from 3-deep subfolders (e.g. docs/implementation-plans/core/archived/): ../../../design/ -> ../../../zh/design/
    (
        re.compile(r'(\.\./\.\./\.\./)design/([a-zA-Z0-9_\-\/\.]+)'),
        r'\1zh/design/\2'
    ),
    (
        re.compile(r'(\.\./\.\./\.\./)tech-designs/([a-zA-Z0-9_\-\/\.]+)'),
        r'\1zh/tech-designs/\2'
    ),
    (
        re.compile(r'(\.\./\.\./\.\./)product/([a-zA-Z0-9_\-\/\.]+)'),
        r'\1zh/product/\2'
    ),
]

def migrate_file(filepath, apply_changes=False):
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception as e:
        return 0, 0

    new_content = content
    changes_count = 0

    for pattern, replacement in MIGRATION_PATTERNS:
        matches = list(pattern.finditer(new_content))
        if matches:
            changes_count += len(matches)
            new_content = pattern.sub(replacement, new_content)

    if changes_count > 0 and apply_changes:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)

    return changes_count, 1 if changes_count > 0 else 0

def run_migration(apply_changes=False):
    print("=" * 80)
    print(f" 🚀 WinkMicroOS Documentation Path Migration (Apply={apply_changes})")
    print("=" * 80)

    total_changes = 0
    modified_files = 0

    # Scan markdown files in docs/ and root
    target_files = []
    for root, _, files in os.walk(DOCS_DIR):
        for f in files:
            if f.endswith(".md") and f != "I18N_IMPLEMENTATION_PLAN.md":
                target_files.append(os.path.join(root, f))

    # Add root MDs
    for f in ["README.md", "CLAUDE.md"]:
        p = os.path.join(WORKSPACE_DIR, f)
        if os.path.exists(p):
            target_files.append(p)

    for filepath in sorted(target_files):
        rel_path = os.path.relpath(filepath, WORKSPACE_DIR).replace("\\", "/")
        changes, modified = migrate_file(filepath, apply_changes=apply_changes)
        if changes > 0:
            total_changes += changes
            modified_files += modified
            print(f"  • [{rel_path}]: {changes} path occurrence(s) updated")

    print("\n" + "-" * 80)
    print(f" Summary: {total_changes} occurrences across {modified_files} file(s).")
    print("=" * 80)

def main():
    parser = argparse.ArgumentParser(description="Migrate docs/ paths to docs/zh/")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    parser.add_argument("--apply", action="store_true", help="Apply changes directly to files")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Please specify --dry-run or --apply")
        sys.exit(1)

    run_migration(apply_changes=args.apply)

if __name__ == "__main__":
    main()
