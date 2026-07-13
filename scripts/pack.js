const tar = require('tar');
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '../package.json');
const packageData = require(packageJsonPath);

const filesToPack = [
    'dist',
    'scripts',
    'package.json',
    'ecosystem.config.js',
    '.env',
    'index.js',
    'www.youtube.com_cookies.txt'
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
