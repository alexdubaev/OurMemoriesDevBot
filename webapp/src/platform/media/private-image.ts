export async function responseToPrivateImageObjectUrl(response: Response) {
  if (!response.ok) throw new Error(`Private media request failed with status ${response.status}`)
  return URL.createObjectURL(await response.blob())
}
