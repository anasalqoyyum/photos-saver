export type ExtensionErrorCode =
  | 'INVALID_IMAGE_URL'
  | 'AUTH_FAILED'
  | 'FETCH_FAILED'
  | 'UPLOAD_FAILED'
  | 'CREATE_FAILED'
  | 'UNKNOWN'

export class ExtensionError extends Error {
  public readonly code: ExtensionErrorCode

  constructor(code: ExtensionErrorCode, message: string) {
    super(message)
    this.name = 'ExtensionError'
    this.code = code
  }
}

export function normalizeError(err: unknown): ExtensionError {
  if (err instanceof ExtensionError) {
    return err
  }

  if (err instanceof Error) {
    return new ExtensionError('UNKNOWN', err.message)
  }

  return new ExtensionError('UNKNOWN', 'Unexpected error occurred.')
}

export function toUserMessage(err: ExtensionError): string {
  switch (err.code) {
    case 'INVALID_IMAGE_URL':
      return 'Cannot save this image URL.'
    case 'AUTH_FAILED':
      return 'Google sign-in failed. Please try again.'
    case 'FETCH_FAILED':
      return 'Image download failed. Site may block access.'
    case 'UPLOAD_FAILED':
      return 'Upload to Google Photos failed.'
    case 'CREATE_FAILED':
      return 'Google Photos could not create the media item.'
    case 'UNKNOWN':
    default:
      return 'Something went wrong while saving image.'
  }
}
