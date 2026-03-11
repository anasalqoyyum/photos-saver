import { describe, expect, it } from 'vitest'

import { buildDescription, ensureExtension, normalizeDescription, resolveFilename, sanitizeFilename } from '../src/filename.ts'

describe('sanitizeFilename', () => {
  it('removes illegal characters', () => {
    expect(sanitizeFilename('my<bad>:name?.jpg')).toBe('my_bad__name_.jpg')
  })
})

describe('ensureExtension', () => {
  it('adds extension from content type', () => {
    expect(ensureExtension('photo', 'image/jpeg; charset=utf-8')).toBe('photo.jpg')
  })
})

describe('resolveFilename', () => {
  it('uses content-disposition filename first', () => {
    const name = resolveFilename({
      sourceUrl: 'https://cdn.example.com/images/x',
      contentDisposition: 'attachment; filename="origin.png"',
      contentType: 'image/png'
    })

    expect(name).toBe('origin.png')
  })
})

describe('normalizeDescription', () => {
  it('truncates to 1000 chars', () => {
    const long = 'a'.repeat(1100)
    expect(normalizeDescription(long).length).toBe(1000)
  })
})

describe('buildDescription', () => {
  it('appends page URL when present', () => {
    expect(buildDescription('https://images.example.com/photo.jpg', 'https://example.com/gallery')).toBe(
      'https://images.example.com/photo.jpg\n\nSaved from: https://example.com/gallery'
    )
  })

  it('ignores missing page URL', () => {
    expect(buildDescription('https://images.example.com/photo.jpg', null)).toBe('https://images.example.com/photo.jpg')
  })

  it('ignores non-http page URL (chrome://, file://, extension)', () => {
    expect(buildDescription('https://images.example.com/photo.jpg', 'chrome://extension://abc123')).toBe(
      'https://images.example.com/photo.jpg'
    )
    expect(buildDescription('https://images.example.com/photo.jpg', 'file:///local/path')).toBe('https://images.example.com/photo.jpg')
    expect(buildDescription('https://images.example.com/photo.jpg', 'moz-extension://xyz')).toBe('https://images.example.com/photo.jpg')
  })
})
