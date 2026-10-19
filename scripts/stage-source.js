#!/usr/bin/env node
/**
 * stage a web app source directory (from a git clone or an unzipped
 * workspace export) into the capacitor webDir.
 *
 * why this exists: workspace exporter tools (e.g. codejack) download a
 * user's entire ai-builder workspace as a zip, and those exports usually wrap
 * everything in one top-level folder. the build step needs to find
 * package.json at the root, so wrapped sources are flattened first.
 *
 * usage: node scripts/stage-source.js <sourceDir> <destDir>
 * exits non-zero with a lowercase error on stderr when the source does not
 * look like a web app (no index.html anywhere we know to look).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [srcArg, destArg] = process.argv.slice(2)
if (!srcArg || !destArg) {
  console.error('usage: node scripts/stage-source.js <sourceDir> <destDir>')
  process.exit(2)
}
const src = resolve(srcArg)
const dest = resolve(destArg)

if (!existsSync(src)) {
  console.error('source directory does not exist')
  process.exit(1)
}

/** descend through single-directory wrappers until a real app root appears */
function flatten(dir, hops = 0) {
  if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'index.html'))) return dir
  if (hops >= 5) return dir
  const entries = readdirSync(dir)
  if (entries.length !== 1) return dir
  const only = join(dir, entries[0])
  return statSync(only).isDirectory() ? flatten(only, hops + 1) : dir
}

/** pick the directory that holds the built web app */
function pickWebRoot(dir) {
  if (existsSync(join(dir, 'package.json'))) {
    for (const out of ['dist', 'build', 'out', 'public']) {
      const candidate = join(dir, out)
      if (existsSync(candidate) && existsSync(join(candidate, 'index.html'))) return candidate
    }
  }
  if (existsSync(join(dir, 'index.html'))) return dir
  return null
}

const root = flatten(src)
const webRoot = pickWebRoot(root)
if (!webRoot) {
  console.error('no index.html found in source: is this a web app?')
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
cpSync(webRoot, dest, {
  recursive: true,
  filter: (from) => {
    const rel = from.slice(webRoot.length)
    return !/node_modules|(^|\/)\.git(\/|$)/.test(rel)
  }
})

if (!existsSync(join(dest, 'index.html'))) {
  console.error('staging failed: index.html missing after copy')
  process.exit(1)
}
console.log(`staged ${webRoot} -> ${dest}`)
