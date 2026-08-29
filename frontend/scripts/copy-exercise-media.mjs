import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXDB } from '../src/lib/exercises-data.js'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privateMediaRoot = resolve(frontendRoot, '..', 'media')
const distRoot = resolve(frontendRoot, 'dist')
const outputRoot = resolve(distRoot, 'media')
const stageRoot = resolve(distRoot, '.media-staging')

if (!outputRoot.startsWith(distRoot + sep)) throw new Error('Refusing to write outside frontend/dist')
if (!stageRoot.startsWith(distRoot + sep)) throw new Error('Refusing to write outside frontend/dist')
if (!existsSync(distRoot)) throw new Error('Build frontend/dist before copying exercise media')

const assertSource = path => {
  if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing private exercise media: ${path}`)
}

const childPath = (root, name) => {
  const path = resolve(root, name)
  if (!path.startsWith(root + sep)) throw new Error(`Refusing unsafe media path: ${name}`)
  return path
}

rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(resolve(stageRoot, 'img'), { recursive: true })
mkdirSync(resolve(stageRoot, 'gif'), { recursive: true })

for (const exercise of EXDB) {
  const image = childPath(resolve(privateMediaRoot, 'img'), exercise.img)
  const animation = childPath(resolve(privateMediaRoot, 'gif'), exercise.gif)
  assertSource(image)
  assertSource(animation)
  copyFileSync(image, childPath(resolve(stageRoot, 'img'), exercise.img))
  copyFileSync(animation, childPath(resolve(stageRoot, 'gif'), exercise.gif))
}

rmSync(outputRoot, { recursive: true, force: true })
renameSync(stageRoot, outputRoot)

console.log(`Copied ${EXDB.length} exercise images and ${EXDB.length} GIFs to frontend/dist/media`)
