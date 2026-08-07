import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AvatarEntry {
  id: string;
  name: string;
  filename: string;
}

class AvatarManifestService {
  private avatarDir: string;
  private manifestPath: string;

  constructor() {
    this.avatarDir = path.join(__dirname, '../../..', 'frontend', 'public', 'wesnoth-avatars');
    this.manifestPath = path.join(this.avatarDir, 'manifest.json');
  }

  /**
   * Converts filename to display name
   * Examples:
   *   ancient-lich.png → Ancient Lich
   *   bowman-(20).png → Bowman (20)
   *   archer.png → Archer
   */
  private filenameToName(filename: string): string {
    return filename
      .replace(/\.png$/, '')        // Remove .png extension
      .replace(/-/g, ' ')           // Replace hyphens with spaces
      .replace(/\b\w/g, (c) => c.toUpperCase()); // Title case
  }

  /**
   * Converts filename to ID
   * Examples:
   *   ancient-lich.png → ancient_lich
   *   bowman-(20).png → bowman_20
   *   archer.png → archer
   */
  private filenameToId(filename: string): string {
    return filename
      .replace(/\.png$/, '')        // Remove extension
      .replace(/[(-)\s]+/g, '_')    // Replace hyphens, parens, spaces with underscores
      .toLowerCase();
  }

  /**
   * Generate avatar manifest from PNG files
   */
  async generateAvatarManifest(): Promise<AvatarEntry[]> {
    try {
      if (!fs.existsSync(this.avatarDir)) {
        console.warn(`⚠️  Avatar directory not found: ${this.avatarDir}`);
        return [];
      }

      // Read all PNG files
      const files = fs.readdirSync(this.avatarDir)
        .filter((f) => f.endsWith('.png'))
        .sort();

      console.log(`📦 Generating avatar manifest from ${files.length} PNG files...`);

      const manifest: AvatarEntry[] = [];
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();

      for (const filename of files) {
        const id = this.filenameToId(filename);
        const name = this.filenameToName(filename);

        // Check for duplicate IDs
        if (seenIds.has(id)) {
          console.warn(`⚠️  Duplicate ID detected: ${id} (from ${filename})`);
          continue;
        }

        // Check for duplicate names
        if (seenNames.has(name)) {
          console.warn(`⚠️  Duplicate name detected: ${name} (from ${filename})`);
          continue;
        }

        seenIds.add(id);
        seenNames.add(name);

        manifest.push({
          id,
          name,
          filename
        });
      }

      console.log(`✅ Generated manifest with ${manifest.length} unique avatars`);

      // Load existing manifest to compare
      let existingManifest: AvatarEntry[] = [];
      if (fs.existsSync(this.manifestPath)) {
        try {
          existingManifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
        } catch (e) {
          console.warn('⚠️  Could not parse existing manifest, will overwrite');
        }
      }

      // Check for changes
      const existingCount = existingManifest.length;
      const newCount = manifest.length;
      const added = newCount - existingCount;

      if (added !== 0) {
        console.log(`📊 Manifest change: ${added > 0 ? '+' : ''}${added} avatars (${existingCount} → ${newCount})`);
      }

      // Write manifest.json
      fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      return manifest;
    } catch (error) {
      console.error('❌ Error generating avatar manifest:', error);
      return [];
    }
  }

  /**
   * Read the generated manifest without rebuilding it on every API request.
   * Build/startup generation is responsible for keeping this derived file current.
   */
  readAvatarManifest(): AvatarEntry[] {
    try {
      if (!fs.existsSync(this.manifestPath)) return [];
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
      return Array.isArray(manifest) ? manifest : [];
    } catch (error) {
      console.error('❌ Error reading avatar manifest:', error);
      return [];
    }
  }

  /**
   * Validate that all manifest entries have corresponding PNG files
   */
  async validateManifest(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.manifestPath)) {
        console.warn('⚠️  Manifest file not found');
        return false;
      }

      const manifest: AvatarEntry[] = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));

      let allValid = true;
      for (const entry of manifest) {
        const filePath = path.join(this.avatarDir, entry.filename);
        if (!fs.existsSync(filePath)) {
          console.warn(`⚠️  Missing file: ${entry.filename} (id: ${entry.id})`);
          allValid = false;
        }
      }

      if (allValid) {
        console.log(`✅ Manifest validation passed (${manifest.length} avatars)`);
      } else {
        console.warn(`⚠️  Manifest validation failed - some files are missing`);
      }

      return allValid;
    } catch (error) {
      console.error('❌ Error validating manifest:', error);
      return false;
    }
  }
}

export const avatarManifestService = new AvatarManifestService();
