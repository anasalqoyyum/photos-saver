import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ensureExtension,
  normalizeDescription,
  resolveFilename,
  sanitizeFilename
} from '../src/filename.ts'

test('sanitizeFilename removes illegal characters', () => {
  assert.equal(sanitizeFilename('my<bad>:name?.jpg'), 'my_bad__name_.jpg')
})

test('ensureExtension adds extension from content type', () => {
  assert.equal(
    ensureExtension('photo', 'image/jpeg; charset=utf-8'),
    'photo.jpg'
  )
})

test('resolveFilename uses content-disposition filename first', () => {
  const name = resolveFilename({
    sourceUrl: 'https://cdn.example.com/images/x',
    contentDisposition: 'attachment; filename="origin.png"',
    contentType: 'image/png'
  })

  assert.equal(name, 'origin.png')
})

test('normalizeDescription truncates to 1000 chars', () => {
  const long = 'a'.repeat(1100)
  assert.equal(normalizeDescription(long).length, 1000)
})
