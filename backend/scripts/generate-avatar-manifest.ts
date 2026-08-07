import { avatarManifestService } from '../src/services/avatarManifestService.js';

const manifest = await avatarManifestService.generateAvatarManifest();
const isValid = manifest.length > 0 && await avatarManifestService.validateManifest();

if (!isValid) {
  console.error('Avatar manifest generation failed or produced no valid entries.');
  process.exitCode = 1;
} else {
  console.log(`Avatar manifest ready with ${manifest.length} entries.`);
}
