#!/usr/bin/env python3
"""
Normalize avatar filenames to lowercase so they resolve on case-sensitive web servers.
This script:
1. Renames physical PNG files to lowercase
2. Updates manifest.json to reference lowercase filenames
"""

import json
import os
from pathlib import Path

# Avatar directory
AVATAR_DIR = Path(__file__).parent.parent / "frontend" / "public" / "wesnoth-units"
MANIFEST_PATH = AVATAR_DIR / "manifest.json"

def normalize_filename(filename):
    """Convert filename to lowercase while preserving extension."""
    if not filename.endswith('.png'):
        return filename
    
    name, ext = filename.rsplit('.', 1)
    return f"{name.lower()}.{ext}"

def rename_physical_files():
    """Rename physical PNG files to lowercase."""
    print("🔄 Renaming physical files to lowercase...")
    renamed_count = 0
    
    for file in sorted(AVATAR_DIR.glob("*.png")):
        old_name = file.name
        new_name = normalize_filename(old_name)
        
        if old_name != new_name:
            new_path = file.parent / new_name
            try:
                file.rename(new_path)
                print(f"  ✓ Renamed: {old_name} → {new_name}")
                renamed_count += 1
            except Exception as e:
                print(f"  ✗ Error renaming {old_name}: {e}")
    
    print(f"✅ Renamed {renamed_count} files")
    return renamed_count

def update_manifest():
    """Update manifest.json to use lowercase filenames."""
    print("\n📝 Updating manifest.json...")
    
    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    updated_count = 0
    for item in manifest:
        old_filename = item['filename']
        new_filename = normalize_filename(old_filename)
        
        if old_filename != new_filename:
            item['filename'] = new_filename
            print(f"  ✓ Updated manifest entry: {old_filename} → {new_filename}")
            updated_count += 1
    
    # Write back the updated manifest
    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Updated {updated_count} manifest entries")
    return updated_count

def verify_files():
    """Verify that all referenced files in manifest exist."""
    print("\n✔️  Verifying file references...")
    
    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    missing = []
    for item in manifest:
        filename = item['filename']
        filepath = AVATAR_DIR / filename
        if not filepath.exists():
            missing.append(filename)
            print(f"  ✗ Missing: {filename}")
    
    if missing:
        print(f"⚠️  Found {len(missing)} missing files")
        return False
    else:
        print(f"✅ All {len(manifest)} files verified successfully")
        return True

def main():
    print("=" * 60)
    print("Avatar Filename Normalization Tool")
    print("=" * 60)
    
    if not AVATAR_DIR.exists():
        print(f"❌ Avatar directory not found: {AVATAR_DIR}")
        return False
    
    if not MANIFEST_PATH.exists():
        print(f"❌ Manifest file not found: {MANIFEST_PATH}")
        return False
    
    # Step 1: Rename physical files
    file_renames = rename_physical_files()
    
    # Step 2: Update manifest
    manifest_updates = update_manifest()
    
    # Step 3: Verify everything
    is_valid = verify_files()
    
    print("\n" + "=" * 60)
    if is_valid:
        print("✅ Normalization completed successfully!")
        print(f"   - {file_renames} files renamed")
        print(f"   - {manifest_updates} manifest entries updated")
    else:
        print("⚠️  Normalization completed with some issues")
        print("   Please check the output above")
    
    print("=" * 60)
    return is_valid

if __name__ == "__main__":
    main()
