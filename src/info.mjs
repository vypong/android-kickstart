// Human-readable descriptions of the options, shared by the CLI and the GUI.
// Both read libraries.json and compat.json, so the two interfaces cannot drift apart.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from './color.mjs';
import { studioOptions, studioFromBuild } from './resolver.mjs';
import { detectStudios } from './scaffold.mjs';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const libraries = JSON.parse(readFileSync(join(toolRoot, 'libraries.json'), 'utf8'));
const compat = JSON.parse(readFileSync(join(toolRoot, 'compat.json'), 'utf8'));

export { libraries };

/** One-line description, used inline in the interactive prompts. */
export function summaryLine(key, width = 62) {
  const lib = libraries[key];
  if (!lib) return '';
  const first = lib.summary.split('. ')[0].replace(/\.$/, '');
  return first.length > width ? first.slice(0, width - 1) + '…' : first;
}

function wrap(text, width, indent) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ' ' + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
}

export function detectedStudioRow() {
  for (const s of detectStudios()) {
    const row = studioFromBuild(s.buildNumber, compat);
    if (row) return row;
  }
  return null;
}

export function printLibrary(key) {
  const lib = libraries[key];
  if (!lib) {
    console.log(`${C.red}unknown option "${key}"${C.off}  ${C.dim}known: ${Object.keys(libraries).join(', ')}${C.off}`);
    return false;
  }
  const pad = '    ';
  const vendor = lib.vendor ? `  ${C.dim}${lib.vendor}${C.off}` : '';
  console.log('');
  console.log(`${C.bold}${lib.name}${C.off}${vendor}`);
  console.log(`${pad}${wrap(lib.summary, 74, pad)}`);
  if (lib.tradeoff) console.log(`${pad}${C.dim}${wrap(lib.tradeoff, 74, pad)}${C.off}`);
  if (lib.github) console.log(`${pad}${C.cyan}${lib.github}${C.off}`);
  if (lib.docs) console.log(`${pad}${C.dim}${lib.docs}${C.off}`);
  return true;
}

export function printLibraries() {
  console.log('');
  console.log(`${C.bold}Options available to --di / --network / --db / --prefs${C.off}`);
  for (const key of Object.keys(libraries)) printLibrary(key);
  console.log('');
}

export function printStudios() {
  const detected = detectedStudioRow();
  console.log('');
  console.log(`${C.bold}Android Studio releases${C.off} ${C.dim}- each sets the highest AGP it can open${C.off}`);
  console.log('');
  console.log(`  ${C.dim}${'#'.padStart(2)}  ${'RELEASE'.padEnd(32)} ${'AGP'.padEnd(8)} ${'GRADLE'.padEnd(9)} ${'JDK'.padEnd(4)} SDK${C.off}`);

  for (const [i, s] of studioOptions(compat).entries()) {
    const here = detected && s.version === detected.version;
    const mark = here ? `${C.green}  <- detected on this machine${C.off}` : '';
    const sdk = s.compileSdkVerified ? String(s.maxCompileSdk) : `${s.maxCompileSdk}?`;
    const row = `  ${String(i + 1).padStart(2)}  ${s.label.padEnd(32)} ${('<=' + s.agpMax).padEnd(8)} `
      + `${String(s.gradle).padEnd(9)} ${String(s.jdk).padEnd(4)} ${sdk}`;
    console.log(here ? `${C.green}${row}${C.off}${mark}` : row + mark);
  }

  console.log('');
  console.log(`  ${C.dim}"?" = compileSdk ceiling inferred, not read from that AGP's release notes.${C.off}`);
  console.log(`  ${C.dim}--studio=<number|name|version|AGP>   e.g. --studio=Narwhal, =2025.1.1, =8.13${C.off}`);
  console.log(`  ${C.dim}--studio=latest                      no cap, newest AGP available${C.off}`);
  console.log('');
}
