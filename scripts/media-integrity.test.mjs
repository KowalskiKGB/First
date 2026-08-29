import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import test from 'node:test'

import { EXDB } from '../frontend/src/lib/exercises-data.js'

const imgDir = new URL('../media/img/', import.meta.url)
const gifDir = new URL('../media/gif/', import.meta.url)
const files = (dir, extension) => readdirSync(dir).filter(name => name.endsWith(extension)).toSorted()

test('the private media library exactly covers the exercise catalogue', () => {
  const expectedImages = EXDB.map(ex => ex.img).toSorted()
  const expectedGifs = EXDB.map(ex => ex.gif).toSorted()
  const images = files(imgDir, '.jpg')
  const gifs = files(gifDir, '.gif')

  assert.equal(EXDB.length, 1324)
  assert.deepEqual(images, expectedImages)
  assert.deepEqual(gifs, expectedGifs)
  assert.equal(images.every(name => statSync(new URL(name, imgDir)).size > 0), true)
  assert.equal(gifs.every(name => statSync(new URL(name, gifDir)).size > 0), true)
})
