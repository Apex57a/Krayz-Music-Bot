const tar = require('tar');
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '../package.json');
const packageData = require(packageJsonPath);

// Auto-bump the patch version (e.g., 1.0.0 -> 1.0.1)
const versionParts = packageData.version.split('.');
versionParts[2] = parseInt(versionParts[2], 10) + 1;
packageData.version = versionParts.join('.');

fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2));
console.log(`\n[Versioning] Successfully bumped version to v${packageData.version}`);

const filesToPack = [
    'dist',
    'scripts',
    'package.json',
    'ecosystem.config.js',
    '.env',
    'index.js',
];

console.log("Packing files for production deployment:", filesToPack);

tar.c(
  {
    gzip: true,
    file: 'krayz_bot_deploy.tar.gz',
  },
  filesToPack
).then(() => {
    console.log("Tarball created successfully as krayz_bot_deploy.tar.gz!");
}).catch(err => {
    console.error("Error creating tarball:", err);
});
