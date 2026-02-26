import { debug, warn } from './logger.js'

function notify(
  options: chrome.notifications.NotificationCreateOptions
): Promise<void> {
  return new Promise(resolve => {
    const id = `save-to-gphotos-${Date.now()}`
    chrome.notifications.create(id, options, () => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        warn('Failed to create notification.', {
          message: runtimeError.message
        })
      }

      resolve()
    })
  })
}

const NOTIFICATION_ICON =
  'https://fonts.gstatic.com/s/i/productlogos/photos/v9/web-64dp/logo_photos_color_1x_web_64dp.png'

export async function notifySuccess(fileName: string): Promise<void> {
  debug('Showing success notification.', { fileName })
  await notify({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: 'Saved to Google Photos',
    message: `Uploaded ${fileName}`,
    priority: 0
  })
}

export async function notifyInProgress(): Promise<void> {
  debug('Showing in-progress notification.')
  await notify({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: 'Saving to Google Photos',
    message: 'Upload started. Please wait...',
    priority: 0
  })
}

export async function notifyFailure(message: string): Promise<void> {
  debug('Showing failure notification.', { message })
  await notify({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: 'Save to Google Photos failed',
    message,
    priority: 2
  })
}
