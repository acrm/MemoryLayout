#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const versionFile = join(__dirname, '..', 'version.json');
const packageFile = join(__dirname, '..', 'package.json');
const buildNotesFile = join(__dirname, '..', 'build-notes.md');

function getCurrentWeekCode() {
  const date = new Date();
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const week = Math.ceil(((date - startOfYear) / 86400000 + 1) / 7);
  return `${year}w${String(week).padStart(2, '0')}`;
}

function getLastCommitMessage() {
  try {
    return execSync('git log -1 --format=%s', { encoding: 'utf8' }).trim();
  } catch {
    return 'Updates';
  }
}

const versionData = JSON.parse(readFileSync(versionFile, 'utf8'));

const args = process.argv.slice(2);
const isMinor = args.includes('--minor');
const descIdx = args.indexOf('--desc');
const description = descIdx !== -1 ? args[descIdx + 1] : getLastCommitMessage() || 'Updates';

const currentWeek = getCurrentWeekCode();
const weekChanged = versionData.weekCode !== currentWeek;

let newWeek = versionData.weekCode;
let newMinor = versionData.minor;
let newBuild = versionData.build;

if (weekChanged) {
  newWeek = currentWeek;
  newMinor = 0;
  newBuild = 1;
} else if (isMinor) {
  newMinor++;
  newBuild = 1;
} else {
  newBuild++;
}

const newVersion = `${newWeek}-${newMinor}.${newBuild}`;

versionData.weekCode = newWeek;
versionData.minor = newMinor;
versionData.build = newBuild;
versionData.currentVersion = newVersion;

writeFileSync(versionFile, JSON.stringify(versionData, null, 2) + '\n');

const packageData = JSON.parse(readFileSync(packageFile, 'utf8'));
packageData.version = newVersion;
writeFileSync(packageFile, JSON.stringify(packageData, null, 2) + '\n');

const noteEntry = `- ${newVersion} — ${description}\n`;
let buildNotes = '';
if (existsSync(buildNotesFile)) {
  buildNotes = readFileSync(buildNotesFile, 'utf8');
}
if (!buildNotes.includes('# Build Notes')) {
  buildNotes = '# Build Notes\n\n' + buildNotes;
}
writeFileSync(buildNotesFile, buildNotes + noteEntry);

console.log(`✓ Version bumped to ${newVersion}`);
