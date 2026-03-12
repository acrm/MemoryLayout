#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

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

function parseArgs(argv) {
  let isMinor = false;
  let noCommit = false;
  let description = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--minor') {
      isMinor = true;
      continue;
    }

    if (arg === '--no-commit') {
      noCommit = true;
      continue;
    }

    if (arg === '--desc') {
      const descParts = [];
      let next = index + 1;
      while (next < argv.length && !argv[next].startsWith('--')) {
        descParts.push(argv[next]);
        next += 1;
      }
      description = descParts.join(' ').trim();
      index = next - 1;
      continue;
    }

    if (arg.startsWith('--desc=')) {
      description = arg.slice('--desc='.length).trim();
    }
  }

  return { isMinor, noCommit, description };
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0 && !allowFailure) {
    const stderr = result.stderr ? result.stderr.trim() : '';
    const stdout = result.stdout ? result.stdout.trim() : '';
    const details = stderr || stdout || 'git command failed';
    throw new Error(details);
  }

  return result;
}

function isGitRepository() {
  const probe = runGit(['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  return probe.status === 0 && probe.stdout.trim() === 'true';
}

function autoCommitChanges(commitMessage) {
  if (!isGitRepository()) {
    console.warn('! Skipping auto-commit: not inside a git repository.');
    return;
  }

  runGit(['add', '-A']);

  const hasStagedChanges = runGit(['diff', '--cached', '--quiet'], { allowFailure: true });
  if (hasStagedChanges.status === 0) {
    console.warn('! Skipping auto-commit: no staged changes after bump.');
    return;
  }

  if (hasStagedChanges.status !== 1) {
    const stderr = hasStagedChanges.stderr ? hasStagedChanges.stderr.trim() : '';
    const stdout = hasStagedChanges.stdout ? hasStagedChanges.stdout.trim() : '';
    throw new Error(stderr || stdout || 'Unable to determine staged changes.');
  }

  runGit(['commit', '-m', commitMessage]);
}

const versionData = JSON.parse(readFileSync(versionFile, 'utf8'));

const args = process.argv.slice(2);
const parsedArgs = parseArgs(args);
const isMinor = parsedArgs.isMinor;
const description = parsedArgs.description || getLastCommitMessage() || 'Updates';

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

const commitMessage = `${newVersion}: ${description}`;
if (!parsedArgs.noCommit) {
  autoCommitChanges(commitMessage);
}

console.log(`✓ Version bumped to ${newVersion}`);
if (!parsedArgs.noCommit) {
  console.log(`✓ Auto-commit created: ${commitMessage}`);
}
