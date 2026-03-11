import { getAccessToken, invalidateToken } from './auth.js'
import { uploadImageViaBackend } from './backend-api.js'
import { BACKEND_MODE_ENABLED } from './backend-config.js'
import { CONTEXT_MENU_ID, CONTEXT_MENU_TITLE } from './constants.js'
import { normalizeError, toUserMessage } from './errors.js'
import { buildDescription } from './filename.js'
import { fetchImageFromSource } from './image-fetch.js'
import { debug, error as logError, warn } from './logger.js'
import { notifyFailure, notifyInProgress, notifySuccess } from './notify.js'
import { createMediaItem, uploadBytes } from './photos-api.js'

debug('Service worker module loaded.', { extensionId: chrome.runtime.id })

async function createContextMenu(): Promise<void> {
  debug('Refreshing context menu entry.')
  try {
    await chrome.contextMenus.removeAll()
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: CONTEXT_MENU_TITLE,
      contexts: ['image']
    })
    debug('Context menu ready.', { menuId: CONTEXT_MENU_ID })
  } catch (menuError) {
    logError('Failed to create context menu.', {
      message: menuError instanceof Error ? menuError.message : 'Unknown error'
    })
  }
}

chrome.runtime.onInstalled.addListener(() => {
  debug('Extension installed. Initializing context menu.')
  void createContextMenu()
})

chrome.runtime.onStartup.addListener(() => {
  debug('Extension startup detected. Initializing context menu.')
  void createContextMenu()
})

async function uploadImageWithToken(sourceUrl: string, token: string, pageUrl?: string): Promise<string> {
  debug('Beginning upload flow with token.', { sourceUrl })
  const image = await fetchImageFromSource(sourceUrl)
  const description = buildDescription(image.sourceUrl, pageUrl)

  const uploadToken = await uploadBytes({
    token,
    bytes: image.bytes,
    fileName: image.fileName,
    contentType: image.contentType,
    description
  })

  await createMediaItem({
    token,
    uploadToken,
    fileName: image.fileName,
    description
  })

  debug('Upload flow finished successfully.', {
    sourceUrl,
    fileName: image.fileName
  })
  return image.fileName
}

async function uploadImageWithBackend(sourceUrl: string, pageUrl?: string): Promise<string> {
  debug('Using backend upload mode.', { sourceUrl })
  const image = await fetchImageFromSource(sourceUrl)
  await uploadImageViaBackend(image, pageUrl)
  return image.fileName
}

async function saveImageToGooglePhotos(sourceUrl: string, pageUrl?: string): Promise<string> {
  if (BACKEND_MODE_ENABLED) {
    return uploadImageWithBackend(sourceUrl, pageUrl)
  }

  debug('Resolving OAuth token for save request.', { sourceUrl })
  const initialToken = await getAccessToken()

  try {
    return await uploadImageWithToken(sourceUrl, initialToken, pageUrl)
  } catch (error) {
    const normalized = normalizeError(error)
    if (normalized.code !== 'AUTH_FAILED') {
      warn('Save request failed without token refresh.', {
        sourceUrl,
        code: normalized.code,
        message: normalized.message
      })
      throw normalized
    }

    warn('OAuth token rejected during upload. Retrying with refreshed token.', {
      sourceUrl
    })
    await invalidateToken(initialToken)
    const refreshedToken = await getAccessToken()
    return uploadImageWithToken(sourceUrl, refreshedToken, pageUrl)
  }
}

chrome.contextMenus.onClicked.addListener(async info => {
  debug('Context menu click event received.', {
    clickedMenuItemId: String(info.menuItemId),
    expectedMenuItemId: CONTEXT_MENU_ID,
    pageUrl: info.pageUrl,
    srcUrl: info.srcUrl
  })

  if (info.menuItemId !== CONTEXT_MENU_ID) {
    debug('Ignoring context menu click for unrelated menu item.', {
      clickedMenuItemId: String(info.menuItemId)
    })
    return
  }

  const sourceUrl = info.srcUrl
  const pageUrl = info.pageUrl
  debug('Context menu clicked.', {
    hasSourceUrl: !!sourceUrl,
    pageUrl
  })

  if (!sourceUrl) {
    warn('Context click had no source URL.')
    await notifyFailure('No image URL found.')
    return
  }

  try {
    await notifyInProgress()
    const fileName = await saveImageToGooglePhotos(sourceUrl, pageUrl)
    await notifySuccess(fileName)
    debug('Save request completed.', { sourceUrl, fileName })
  } catch (error) {
    const normalized = normalizeError(error)
    const userMessage = toUserMessage(normalized)
    logError('Save request failed.', {
      sourceUrl,
      code: normalized.code,
      message: normalized.message
    })
    await notifyFailure(userMessage)
  }
})
