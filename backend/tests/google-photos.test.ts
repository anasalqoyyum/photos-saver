import { describe, expect, it } from 'vitest'

import { buildUploadDescription } from '../src/services/google-photos.js'

describe('buildUploadDescription', () => {
  it('appends page URL when present', () => {
    expect(buildUploadDescription('https://images.example.com/photo.jpg', 'https://example.com/gallery')).toBe(
      'https://images.example.com/photo.jpg\n\nSaved from: https://example.com/gallery'
    )
  })

  it('ignores missing page URL', () => {
    expect(buildUploadDescription('https://images.example.com/photo.jpg', null)).toBe('https://images.example.com/photo.jpg')
  })

  it('truncates long descriptions', () => {
    const sourceUrl = `https://images.example.com/${'a'.repeat(1200)}`
    expect(buildUploadDescription(sourceUrl).length).toBe(1000)
  })
})
