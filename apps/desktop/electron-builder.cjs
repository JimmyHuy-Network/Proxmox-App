/* global module, require */

// The pinned Electron npm package includes authenticated SHA-256 checksums for
// every platform. Pass them inline so @electron/get can validate cached/downloaded
// archives without fetching SHASUMS256.txt again on every packaging attempt.
module.exports = {
  extends: './electron-builder.yml',
  electronDownload: {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS builder config.
    checksums: require('electron/checksums.json'),
  },
}
