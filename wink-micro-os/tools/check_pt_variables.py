#!/usr/bin/env python3
"""Static analyzer to catch auto variables inside protothreads.

This is the #1 footgun in protothread programming - catch it early at build time!

Detects:
1. Functions that take wink_pt_t* as first argument
2. Contain WINK_PT_YIELD, WINK_PT_DELAY_MS, or WINK_PT_WAIT_*
3. Declare non-static automatic variables inside

False positive suppression:
- Loop counters (i, j, k) declared immediately before for(...)
- Variables declared before WINK_PT_BEGIN (executed on every call)
"""
import re
import sys
import os


def find_all_pt_functions(content):
    """Find all protothread functions and their line ranges."""
    # Match function definition: wink_status_t name(wink_pt_t *pt, ...) {
    func_pattern = re.compile(
        r'^\s*wink_status_t\s+(\w+)\s*\(\s*wink_pt_t\s*\*\s*\w+',
        re.MULTILINE
    )

    functions = []
    for match in func_pattern.finditer(content):
        func_name = match.group(1)
        start_pos = match.end()

        # Find matching closing brace (simplified - count braces)
        brace_count = 1
        pos = start_pos
        while brace_count > 0 and pos < len(content):
            if content[pos] == '{':
                brace_count += 1
            elif content[pos] == '}':
                brace_count -= 1
            pos += 1

        func_body_start = start_pos
        func_body_end = pos

        # Check if this function has any yield points
        func_body = content[func_body_start:func_body_end]
        has_yield = (
            'WINK_PT_YIELD' in func_body or
            'WINK_PT_DELAY_MS' in func_body or
            'WINK_PT_WAIT_' in func_body
        )

        if has_yield:
            # Find line number
            line_no = content[:match.start()].count('\n') + 1
            functions.append({
                'name': func_name,
                'line': line_no,
                'body_start': func_body_start,
                'body_end': func_body_end,
                'body': func_body
            })

    return functions


def find_auto_variables(func_info, content):
    """Find suspicious non-static auto variables in a protothread function."""
    errors = []

    # Find variable declarations inside the function
    # Pattern: type name = ...; or type name;
    # Negative lookbehind for 'static '
    var_pattern = re.compile(
        r'(?<!static\s)(?<!static\s+)\b'
        r'(int|uint8_t|uint16_t|uint32_t|uint64_t|'
        r'float|double|char|bool|size_t|int8_t|int16_t|int32_t|int64_t)\s+'
        r'([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:[;=]|\[)',
        re.MULTILINE
    )

    # Find WINK_PT_BEGIN position in function
    pt_begin_match = re.search(r'WINK_PT_BEGIN', func_info['body'])
    if not pt_begin_match:
        return errors  # No PT_BEGIN - not a real protothread

    pt_begin_offset = func_info['body_start'] + pt_begin_match.end()

    for var_match in var_pattern.finditer(content, func_info['body_start'], func_info['body_end']):
        var_type = var_match.group(1).strip()
        var_name = var_match.group(2)

        # Skip loop counters (i, j, k) if immediately followed by for loop
        var_end = var_match.end()
        remainder = content[var_end:var_end + 20]
        if var_name in ('i', 'j', 'k') and 'for(' in remainder.replace(' ', ''):
            continue

        # Skip variables declared BEFORE WINK_PT_BEGIN (executed on every call)
        if var_match.start() < pt_begin_offset:
            continue

        # Calculate absolute line number in file
        line_no = content[:var_match.start()].count('\n') + 1

        errors.append({
            'line': line_no,
            'func': func_info['name'],
            'var': var_name,
            'type': var_type,
            'message': (
                f"[FOOTGUN] Non-static auto variable '{var_name}' "
                f"in protothread '{func_info['name']}'"
            )
        })

    return errors


def check_file(filepath):
    """Check a single C file for protothread footguns."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except (OSError, UnicodeDecodeError):
        return []

    all_errors = []
    functions = find_all_pt_functions(content)

    for func in functions:
        errors = find_auto_variables(func, content)
        all_errors.extend(errors)

    return all_errors


def main():
    all_errors = []

    # Check all C files in wink-micro-os
    for root, dirs, files in os.walk('.'):
        for f in files:
            if f.endswith('.c'):
                filepath = os.path.join(root, f)
                all_errors.extend(check_file(filepath))

    if all_errors:
        print(f"\n{'=' * 70}")
        print(f"[FAIL] FOUND {len(all_errors)} PROTOTHREAD FOOTGUNS!")
        print(f"{'=' * 70}")
        print(f"Stack variables in protothreads get DESTROYED after yield!")
        print(f"Fix: Use 'static {all_errors[0]['var']}' or WINK_PT_STATE_* macros.")
        print(f"{'=' * 70}\n")
        for e in all_errors:
            print(f"  {e['line']:4d}: {e['message']}")
        print(f"\n{'=' * 70}\n")
        return 1
    else:
        print("[OK] No protothread footguns detected - you are safe!")
        return 0


if __name__ == '__main__':
    sys.exit(main())
