#!/usr/bin/env node
/**
 * Copy the CryptPad embedding-fix overlay into `lib/cryptpad-fixes`.
 *
 * The packaged desktop app always ships `lib/**`, but historically it did not
 * always ship the top-level `vendor/**` tree (pnpm `file:` dependencies are
 * packed from the `files` allow-list and stale installs can drop it).  By
 * putting the runtime overlay under `lib/` during `pnpm run build`, the plugin
 * becomes independent of `vendor/**` being present in the packed dependency.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'vendor', 'cryptpad-fixes')
const target = join(root, 'lib', 'cryptpad-fixes')

if (!existsSync(join(source, 'template.js'))) {
  console.error(`[dsh-plugin-cryptpad] copy-fixes: source overlay missing: ${source}`)
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`[dsh-plugin-cryptpad] copied embedding fixes to ${target}`)
