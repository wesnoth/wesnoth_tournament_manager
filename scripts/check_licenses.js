const fs = require('fs');
const path = require('path');

function getLicenses(packagePath) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const licenses = {};

  Object.keys(dependencies).forEach((dependency) => {
    try {
      const dependencyPackage = JSON.parse(
        fs.readFileSync(path.join(packagePath, 'node_modules', dependency, 'package.json'), 'utf8'),
      );
      licenses[dependency] = dependencyPackage.license || 'UNKNOWN';
    } catch {
      licenses[dependency] = 'NOT_FOUND';
    }
  });

  return licenses;
}

for (const [label, packagePath] of [['BACKEND', './backend'], ['FRONTEND', './frontend']]) {
  console.log(`===== ${label} DEPENDENCIES AND LICENSES =====\n`);
  const licenses = getLicenses(packagePath);
  Object.keys(licenses).sort().forEach((dependency) => {
    console.log(`${dependency}: ${licenses[dependency]}`);
  });
  console.log('');
}
