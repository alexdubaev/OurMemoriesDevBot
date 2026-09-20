export type UploadProgress = (loaded: number, total: number) => void

export function uploadVideoToMax(
  providerUrl: string,
  file: File,
  signal: AbortSignal,
  onProgress?: UploadProgress,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('data', file, file.name)
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => {
      xhr.abort()
      finish(abortError())
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) finish()
      else finish(new Error('Не удалось загрузить видео'))
    })
    xhr.addEventListener('error', () => finish(new Error('Не удалось загрузить видео')))
    xhr.addEventListener('abort', () => finish(abortError()))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }

    try {
      xhr.open('POST', providerUrl)
      // Deliberately do not set Authorization or any other provider header. The capability URL
      // and the multipart file are the complete browser-side upload contract.
      xhr.send(form)
    } catch {
      finish(new Error('Не удалось загрузить видео'))
    }
  })
}

function abortError() {
  return typeof DOMException === 'function'
    ? new DOMException('Загрузка отменена', 'AbortError')
    : Object.assign(new Error('Загрузка отменена'), { name: 'AbortError' })
}
