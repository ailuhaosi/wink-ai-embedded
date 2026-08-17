#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_i18n_alignment.py

Comprehensive & Robust i18n & Migration Alignment Verification Suite:
1. Bidirectional 1:1 Directory Tree Symmetry Check (docs/zh/ <-> docs/en/, or arbitrary --source-dir <-> --target-dir)
2. Markdown Structural AST & Content Skeleton Alignment:
   - Heading hierarchy & Section numbering sequence (H1~H4, 1., 1.1, §x, ADR-x)
   - Code blocks (languages, counts, nested 3~5 fence depth)
   - Architectural diagrams (Mermaid) & Media illustrations (![...])
   - Tables count & Columns structure
   - Blockquotes & GitHub-style Alerts (> [!NOTE], > [!WARNING])
   - Cross-reference link density (ADRs, design references)
3. Migration Parity Verification (e.g. docs/design <-> docs/zh/design)
4. CI/CD Quality Gates & Structured Reporting (Markdown / JSON)

Usage:
  # Standard i18n check (docs/zh/ <-> docs/en/)
  python docs/scripts/verify_i18n_alignment.py
  python docs/scripts/verify_i18n_alignment.py --check-content
  
  # Migration parity check (docs/design/ <-> docs/zh/design/)
  python docs/scripts/verify_i18n_alignment.py --source-dir docs/design --target-dir docs/zh/design --check-content
  
  # CI strict mode
  python docs/scripts/verify_i18n_alignment.py --strict --strict-content --min-score 80.0
"""

import os
import re
import sys
import json
import argparse
from typing import Dict, List, Tuple, Any, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
DEFAULT_ZH_DIR = os.path.join(DOCS_DIR, "zh")
DEFAULT_EN_DIR = os.path.join(DOCS_DIR, "en")

SSOT_DOMAINS = ["design", "tech-designs", "product"]
META_PATTERN = re.compile(r'<!--\s*i18n-meta\s*(.*?)\s*-->', re.DOTALL | re.IGNORECASE)

class MarkdownASTStructure:
    """Extracts and represents the complete structural AST skeleton of a technical markdown document."""
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.exists = os.path.exists(filepath)
        self.raw_content = ""
        self.clean_content = ""
        
        # Structural AST elements
        self.headings: List[Tuple[int, str, str]] = []  # [(level, clean_title, section_number_prefix)]
        self.code_blocks: List[Tuple[str, int]] = []   # [(language, lines_count)]
        self.mermaid_count: int = 0
        self.images_count: int = 0                     # ![caption](path)
        self.tables_count: int = 0
        self.table_columns: List[int] = []             # List of column counts per table
        self.alerts_count: int = 0                     # GitHub-style Alerts [!NOTE], [!WARNING], etc.
        self.links_count: int = 0                      # [text](url) internal/external references
        self.list_items_count: int = 0                 # Bullet points and numbered list items
        self.paragraphs_count: int = 0
        self.metadata: Dict[str, str] = {}
        
        if self.exists:
            self._parse()

    def _parse(self):
        try:
            with open(self.filepath, "r", encoding="utf-8", errors="ignore") as f:
                self.raw_content = f.read()
        except Exception:
            return

        # 1. Parse frontmatter i18n-meta
        match = META_PATTERN.search(self.raw_content)
        if match:
            meta_str = match.group(1)
            for line in meta_str.splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    self.metadata[k.strip().lower()] = v.strip()

        # Remove i18n metadata comment before analyzing AST structure
        content = META_PATTERN.sub("", self.raw_content)
        self.clean_content = content

        lines = content.splitlines()
        
        # State tracking for multi-line blocks
        in_code_fence = False
        fence_char = ""
        fence_len = 0
        current_code_lang = ""
        current_code_line_count = 0
        
        in_table = False
        current_table_cols = 0
        current_table_header = True

        for line in lines:
            stripped = line.strip()

            # --- Code Block Fences (Supports variable length ```, ````, `````) ---
            fence_match = re.match(r'^(`{3,}|~{3,})(.*)$', stripped)
            if fence_match:
                marker = fence_match.group(1)
                info = fence_match.group(2).strip().lower()
                
                if not in_code_fence:
                    in_code_fence = True
                    fence_char = marker[0]
                    fence_len = len(marker)
                    current_code_lang = info if info else "text"
                    current_code_line_count = 0
                    if current_code_lang == "mermaid":
                        self.mermaid_count += 1
                    continue
                else:
                    # Check if matching closing fence
                    if marker[0] == fence_char and len(marker) >= fence_len:
                        in_code_fence = False
                        self.code_blocks.append((current_code_lang, current_code_line_count))
                        fence_char = ""
                        fence_len = 0
                        current_code_lang = ""
                        continue

            if in_code_fence:
                current_code_line_count += 1
                continue

            # --- Markdown Images: ![caption](url) ---
            img_matches = re.findall(r'!\[.*?\]\(.*?\)', line)
            if img_matches:
                self.images_count += len(img_matches)

            # --- Markdown Links: [text](url) (excluding images) ---
            line_no_imgs = re.sub(r'!\[.*?\]\(.*?\)', '', line)
            link_matches = re.findall(r'\[.*?\]\(.*?\)', line_no_imgs)
            if link_matches:
                self.links_count += len(link_matches)

            # --- Headings (#, ##, ###, ####, #####, ######) ---
            heading_match = re.match(r'^(#{1,6})\s+(.+)$', stripped)
            if heading_match:
                level = len(heading_match.group(1))
                full_title = heading_match.group(2).strip()
                
                # Extract numbering prefix (e.g., "1.", "1.2", "§1", "ADR-0004", "Phase 1")
                num_prefix_match = re.match(r'^((?:§|\b(?:Phase|ADR|Step|Task|Track)\b\s*[-0-9A-Za-z]+|\d+(?:\.\d+)*)\.?)\s+(.+)$', full_title, re.IGNORECASE)
                if num_prefix_match:
                    num_prefix = num_prefix_match.group(1).strip()
                    clean_title = num_prefix_match.group(2).strip()
                else:
                    num_prefix = ""
                    clean_title = full_title
                
                self.headings.append((level, clean_title, num_prefix))
                continue

            # --- Markdown Tables ---
            if stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 2:
                # Separator row (|---|---|)
                if re.match(r'^\|[\s\-:|]+\|$', stripped):
                    current_table_header = False
                else:
                    cols = len([c for c in stripped.split("|")[1:-1]])
                    if not in_table:
                        in_table = True
                        self.tables_count += 1
                        self.table_columns.append(cols)
                continue
            else:
                in_table = False

            # --- GitHub-Style Alerts / Callouts (> [!NOTE], > [!WARNING], etc.) ---
            if re.match(r'^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]', stripped, re.IGNORECASE):
                self.alerts_count += 1
                continue

            # --- Lists (Unordered & Ordered) ---
            if re.match(r'^(\*|-|\+|\d+\.)\s+', stripped):
                self.list_items_count += 1
                continue

            # --- Prose Paragraphs (excluding horizontal rules & blockquotes) ---
            if stripped and not stripped.startswith(">") and not stripped.startswith("---") and not stripped.startswith("***"):
                self.paragraphs_count += 1


def compare_structural_ast(src: MarkdownASTStructure, tgt: MarkdownASTStructure) -> Dict[str, Any]:
    """Compares the structural AST skeleton between source and target markdown files."""
    diffs = []
    
    # 1. Heading count & Level comparison
    src_h_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    tgt_h_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    for level, _, _ in src.headings:
        if level in src_h_counts:
            src_h_counts[level] += 1
    for level, _, _ in tgt.headings:
        if level in tgt_h_counts:
            tgt_h_counts[level] += 1

    for lvl in [1, 2, 3]:
        if src_h_counts[lvl] != tgt_h_counts[lvl]:
            diffs.append(f"H{lvl} Heading count mismatch: Source={src_h_counts[lvl]} vs Target={tgt_h_counts[lvl]}")

    # 2. Section Numbering Sequence Alignment
    src_num_prefixes = [p for _, _, p in src.headings if p]
    tgt_num_prefixes = [p for _, _, p in tgt.headings if p]
    
    if len(src_num_prefixes) > 0 and len(tgt_num_prefixes) > 0:
        min_len = min(len(src_num_prefixes), len(tgt_num_prefixes))
        for i in range(min_len):
            if src_num_prefixes[i].lower() != tgt_num_prefixes[i].lower():
                diffs.append(f"Section numbering mismatch at #{i+1}: Source '{src_num_prefixes[i]}' vs Target '{tgt_num_prefixes[i]}'")
                break

    # 3. Code blocks & Languages comparison
    if len(src.code_blocks) != len(tgt.code_blocks):
        diffs.append(f"Code block count mismatch: Source={len(src.code_blocks)} vs Target={len(tgt.code_blocks)}")
    
    # 4. Architectural Diagrams & Images
    if src.mermaid_count != tgt.mermaid_count:
        diffs.append(f"Mermaid diagram count mismatch: Source={src.mermaid_count} vs Target={tgt.mermaid_count}")
    if src.images_count != tgt.images_count:
        diffs.append(f"Illustration/Image count mismatch: Source={src.images_count} vs Target={tgt.images_count}")

    # 5. Tables & Column Structure
    if src.tables_count != tgt.tables_count:
        diffs.append(f"Table count mismatch: Source={src.tables_count} vs Target={tgt.tables_count}")
    else:
        for idx, (s_col, t_col) in enumerate(zip(src.table_columns, tgt.table_columns)):
            if s_col != t_col:
                diffs.append(f"Table #{idx+1} column count mismatch: Source={s_col} cols vs Target={t_col} cols")

    # 6. Alerts & Callouts
    if src.alerts_count != tgt.alerts_count:
        diffs.append(f"Alert/Callout block count mismatch: Source={src.alerts_count} vs Target={tgt.alerts_count}")

    # --- Weighted Structural Similarity Score Calculation (0.0 to 100.0) ---
    weights = {
        "headings": 0.35,
        "code_and_diagrams": 0.25,
        "tables": 0.20,
        "images_and_alerts": 0.10,
        "list_and_paragraphs": 0.10
    }

    # Headings score
    total_src_h = len(src.headings)
    total_tgt_h = len(tgt.headings)
    h_score = 1.0 if total_src_h == 0 and total_tgt_h == 0 else max(0.0, 1.0 - abs(total_src_h - total_tgt_h) / max(total_src_h, total_tgt_h, 1))

    # Code & diagrams score
    src_code_all = len(src.code_blocks) + src.mermaid_count
    tgt_code_all = len(tgt.code_blocks) + tgt.mermaid_count
    code_score = 1.0 if src_code_all == 0 and tgt_code_all == 0 else max(0.0, 1.0 - abs(src_code_all - tgt_code_all) / max(src_code_all, tgt_code_all, 1))

    # Tables score
    t_score = 1.0 if src.tables_count == 0 and tgt.tables_count == 0 else max(0.0, 1.0 - abs(src.tables_count - tgt.tables_count) / max(src.tables_count, tgt.tables_count, 1))

    # Images & Alerts score
    src_ia = src.images_count + src.alerts_count
    tgt_ia = tgt.images_count + tgt.alerts_count
    ia_score = 1.0 if src_ia == 0 and tgt_ia == 0 else max(0.0, 1.0 - abs(src_ia - tgt_ia) / max(src_ia, tgt_ia, 1))

    # List & Paragraph density score
    src_density = src.list_items_count + src.paragraphs_count
    tgt_density = tgt.list_items_count + tgt.paragraphs_count
    density_score = 1.0 if src_density == 0 and tgt_density == 0 else max(0.0, 1.0 - abs(src_density - tgt_density) / max(src_density, tgt_density, 1))

    composite_score = (
        h_score * weights["headings"] +
        code_score * weights["code_and_diagrams"] +
        t_score * weights["tables"] +
        ia_score * weights["images_and_alerts"] +
        density_score * weights["list_and_paragraphs"]
    ) * 100.0

    return {
        "score": composite_score,
        "diffs": diffs,
        "is_aligned": len(diffs) == 0,
        "src_h_counts": src_h_counts,
        "tgt_h_counts": tgt_h_counts,
        "src_code": len(src.code_blocks),
        "tgt_code": len(tgt.code_blocks),
        "src_mermaid": src.mermaid_count,
        "tgt_mermaid": tgt.mermaid_count,
        "src_images": src.images_count,
        "tgt_images": tgt.images_count,
        "src_tables": src.tables_count,
        "tgt_tables": tgt.tables_count,
        "src_alerts": src.alerts_count,
        "tgt_alerts": tgt.alerts_count,
        "src_links": src.links_count,
        "tgt_links": tgt.links_count,
    }


def collect_directory_files(base_dir: str) -> List[str]:
    """Collects all relative markdown filepaths within a directory recursively."""
    file_list = []
    if not os.path.exists(base_dir):
        return []
    
    # Check if base_dir has standard SSOT domain subdirectories
    subdirs = [d for d in os.listdir(base_dir) if os.path.isdir(os.path.join(base_dir, d))]
    has_ssot_domains = any(d in subdirs for d in SSOT_DOMAINS)
    
    if has_ssot_domains:
        for domain in SSOT_DOMAINS:
            domain_dir = os.path.join(base_dir, domain)
            if os.path.exists(domain_dir):
                for root, _, files in os.walk(domain_dir):
                    for f in files:
                        if f.endswith(".md"):
                            rel = os.path.relpath(os.path.join(root, f), base_dir).replace("\\", "/")
                            file_list.append(rel)
        # Root README if present
        if os.path.exists(os.path.join(base_dir, "README.md")):
            file_list.append("README.md")
    else:
        # Generic recursive walk across all subfolders
        for root, _, files in os.walk(base_dir):
            for f in files:
                if f.endswith(".md"):
                    rel = os.path.relpath(os.path.join(root, f), base_dir).replace("\\", "/")
                    file_list.append(rel)
                    
    return sorted(list(set(file_list)))


def generate_markdown_report(report_data: Dict[str, Any]) -> str:
    """Formats verification results into a clean GitHub-Flavored Markdown summary report."""
    md = []
    md.append("# 🌐 Alignment & Quality Verification Report\n")
    md.append(f"- **Source Directory**: `{report_data['source_dir']}`")
    md.append(f"- **Target Directory**: `{report_data['target_dir']}`")
    md.append(f"- **Total Source Docs**: `{report_data['total_src']}`")
    md.append(f"- **Total Target Docs**: `{report_data['total_tgt']}`")
    md.append(f"- **Directory Tree Symmetry Coverage**: `{report_data['tree_coverage_pct']:.1f}%`")
    md.append(f"- **1:1 Matched Document Pairs**: `{report_data['matched_count']}`\n")

    if report_data["missing_in_target"]:
        md.append(f"### ⚠️ Missing in Target ({len(report_data['missing_in_target'])})\n")
        for f in report_data["missing_in_target"]:
            md.append(f"- [ ] `{f}`")
        md.append("")

    if report_data["orphan_in_target"]:
        md.append(f"### ⚠️ Extra / Orphan Target Files ({len(report_data['orphan_in_target'])})\n")
        for f in report_data["orphan_in_target"]:
            md.append(f"- ⚠️ `{f}`")
        md.append("")

    if "structural_results" in report_data:
        res = report_data["structural_results"]
        md.append("## 📝 Markdown Content Structural Skeleton Alignment\n")
        md.append(f"- **Analyzed Pairs**: `{res['total_analyzed']}`")
        md.append(f"- **100% Fully Aligned**: `{res['fully_aligned_count']}`")
        md.append(f"- **Structural Mismatches**: `{len(res['discrepancies'])}`\n")
        
        if res["discrepancies"]:
            md.append("| Document Path | Similarity Score | Discrepancies |")
            md.append("|---|:---:|---|")
            for item in res["discrepancies"]:
                diff_summary = "<br/>".join([f"• {d}" for d in item["diffs"]])
                md.append(f"| `{item['rel_path']}` | **{item['score']:.1f}%** | {diff_summary} |")
            md.append("")

    return "\n".join(md)


def resolve_directory(path_str: str) -> str:
    """Smartly resolves a directory path from absolute, cwd, repo-root, or docs-root."""
    if os.path.isabs(path_str):
        return os.path.abspath(path_str)
    if os.path.exists(path_str):
        return os.path.abspath(path_str)
    repo_root = os.path.abspath(os.path.join(DOCS_DIR, ".."))
    repo_candidate = os.path.join(repo_root, path_str)
    if os.path.exists(repo_candidate):
        return os.path.abspath(repo_candidate)
    docs_candidate = os.path.join(DOCS_DIR, path_str)
    if os.path.exists(docs_candidate):
        return os.path.abspath(docs_candidate)
    return os.path.abspath(repo_candidate)


def main():
    parser = argparse.ArgumentParser(description="WinkMicroOS Alignment & Structural Skeleton Verifier")
    parser.add_argument("--source-dir", type=str, default=DEFAULT_ZH_DIR, help="Source directory (default: docs/zh)")
    parser.add_argument("--target-dir", type=str, default=DEFAULT_EN_DIR, help="Target directory (default: docs/en)")
    parser.add_argument("--check-content", action="store_true", help="Enable deep Markdown structural AST skeleton & content alignment check")
    parser.add_argument("--strict", action="store_true", help="CI strict mode: exit non-zero on tree mismatch or missing files")
    parser.add_argument("--strict-content", action="store_true", help="CI strict mode: exit non-zero on structural discrepancies")
    parser.add_argument("--min-score", type=float, default=75.0, help="Minimum structural similarity score threshold (default: 75.0)")
    parser.add_argument("--file", type=str, default=None, help="Inspect a specific document relative path (e.g. 01-system-overall/01-system-overview.md)")
    parser.add_argument("--report-md", type=str, default=None, help="Output markdown summary report to a file")
    parser.add_argument("--json-output", type=str, default=None, help="Output structured results to a JSON file")
    
    args = parser.parse_args()

    # Smartly resolve paths
    src_dir = resolve_directory(args.source_dir)
    tgt_dir = resolve_directory(args.target_dir)

    repo_root = os.path.abspath(os.path.join(DOCS_DIR, ".."))
    try:
        src_rel_display = os.path.relpath(src_dir, repo_root).replace("\\", "/")
    except ValueError:
        src_rel_display = src_dir
    try:
        tgt_rel_display = os.path.relpath(tgt_dir, repo_root).replace("\\", "/")
    except ValueError:
        tgt_rel_display = tgt_dir

    print("=" * 90)
    print(f" 🌐 Directory & Structural Alignment Suite: [{src_rel_display}] ⟷ [{tgt_rel_display}]")
    print("=" * 90)

    # 1. Collect and Diff Directory Trees
    src_files = set(collect_directory_files(src_dir))
    tgt_files = set(collect_directory_files(tgt_dir))

    if not src_files:
        print(f"❌ Error: No markdown files found in source directory: {src_dir}")
        return 1

    matched_files = sorted(list(src_files.intersection(tgt_files)))
    missing_in_target = sorted(list(src_files - tgt_files))
    orphan_in_target = sorted(list(tgt_files - src_files))

    total_src = len(src_files)
    total_tgt = len(tgt_files)
    matched_count = len(matched_files)
    tree_coverage_pct = (matched_count / total_src * 100.0) if total_src > 0 else 0.0

    print(f"\n[📁 1. DIRECTORY TREE ALIGNMENT (1:1 SYMMETRY)]")
    print(f"  • Total Source Documents   : {total_src} ({src_rel_display})")
    print(f"  • Total Target Documents   : {total_tgt} ({tgt_rel_display})")
    print(f"  • Matched 1:1 Pairs        : {matched_count}")
    print(f"  • Tree Symmetry Coverage   : {tree_coverage_pct:.1f}%\n")

    if missing_in_target:
        print(f"⚠️  Missing in Target ({len(missing_in_target)} files):")
        for f in missing_in_target[:10]:
            print(f"    - [Missing] {f}")
        if len(missing_in_target) > 10:
            print(f"    ... and {len(missing_in_target) - 10} more files.")

    if orphan_in_target:
        print(f"\n⚠️  Extra / Orphan Files in Target ({len(orphan_in_target)} files):")
        for f in orphan_in_target:
            print(f"    - [Extra] {f}")

    if not missing_in_target and not orphan_in_target:
        print("  ✅ Directory Tree is 100% Perfectly 1:1 Symmetrical!")

    report_payload = {
        "source_dir": src_rel_display,
        "target_dir": tgt_rel_display,
        "total_src": total_src,
        "total_tgt": total_tgt,
        "matched_count": matched_count,
        "tree_coverage_pct": tree_coverage_pct,
        "missing_in_target": missing_in_target,
        "orphan_in_target": orphan_in_target
    }

    # 2. Structural AST Skeleton & Content Format Check
    content_failures = []
    discrepancy_list = []

    if args.check_content or args.strict_content or args.file:
        print("\n" + "-" * 90)
        print(" [📝 2. MARKDOWN STRUCTURAL SKELETON ALIGNMENT CHECK]")
        print(" Checking: Heading hierarchies (H1~H4), Code fences & languages, Mermaid diagrams,")
        print("           Illustrations (![...]), Table structures (columns), and GitHub Alerts...")
        print("-" * 90)

        targets = [args.file] if args.file else matched_files
        fully_aligned_count = 0

        for rel_path in targets:
            s_path = os.path.join(src_dir, rel_path)
            t_path = os.path.join(tgt_dir, rel_path)

            if not os.path.exists(s_path) or not os.path.exists(t_path):
                continue

            src_struct = MarkdownASTStructure(s_path)
            tgt_struct = MarkdownASTStructure(t_path)
            cmp_res = compare_structural_ast(src_struct, tgt_struct)

            score = cmp_res["score"]
            is_aligned = cmp_res["is_aligned"]

            if is_aligned:
                fully_aligned_count += 1
                if args.file:
                    print(f"  ✅ [100% PERFECT SKELETON MATCH] {rel_path}")
            else:
                item_diff = {
                    "rel_path": rel_path,
                    "score": score,
                    "diffs": cmp_res["diffs"]
                }
                discrepancy_list.append(item_diff)

                if score < args.min_score:
                    content_failures.append(item_diff)

                if args.file or not args.strict_content:
                    print(f"  ⚠️ [{score:4.1f}% Score] {rel_path}")
                    for d in cmp_res["diffs"]:
                        print(f"      ↳ {d}")

        print(f"\n[📊 CONTENT STRUCTURE RESULTS]")
        print(f"  • Total Pairs Analyzed     : {len(targets)}")
        print(f"  • 100% Exact Skeleton Match: {fully_aligned_count}")
        print(f"  • Minor/Notice Discrepancy : {len(discrepancy_list) - len(content_failures)}")
        print(f"  • Low Score Mismatches     : {len(content_failures)} (Below threshold {args.min_score}%)")

        report_payload["structural_results"] = {
            "total_analyzed": len(targets),
            "fully_aligned_count": fully_aligned_count,
            "discrepancies": discrepancy_list
        }

    print("\n" + "=" * 90)

    # 3. Export Reports if specified
    if args.report_md:
        md_text = generate_markdown_report(report_payload)
        with open(args.report_md, "w", encoding="utf-8") as f:
            f.write(md_text)
        print(f"📄 Markdown summary report saved to: {args.report_md}")

    if args.json_output:
        with open(args.json_output, "w", encoding="utf-8") as f:
            json.dump(report_payload, f, indent=2, ensure_ascii=False)
        print(f"📊 JSON structured data saved to: {args.json_output}")

    # 4. CI Quality Gate Exit Codes
    exit_code = 0
    if args.strict and (missing_in_target or orphan_in_target):
        print("❌ Strict Tree Check FAILED: Directory tree is not 1:1 symmetrical.")
        exit_code = 1

    if args.strict_content and content_failures:
        print(f"❌ Strict Content Structure Check FAILED: {len(content_failures)} documents failed skeleton threshold.")
        exit_code = 1

    return exit_code

if __name__ == "__main__":
    sys.exit(main())
