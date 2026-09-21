import assetManifest from '../../../assets/manifest.json'

import type { WebpIconName, WebpIconState } from './webp-icon-types'

type WebpIconDensity = 2 | 3

const assetsByPath = new Map(
  assetManifest.items.map((asset) => [asset.path, asset]),
)

export function resolveWebpIconSource(
  name: WebpIconName,
  state: WebpIconState,
  density: WebpIconDensity,
) {
  const path = `assets/icons/${name}-${state}@${density}x.webp`
  const asset = assetsByPath.get(path)
  const expectedPixels = density === 2 ? 48 : 72

  if (
    !asset
    || asset.usage !== 'runtime-icon'
    || asset.alpha !== true
    || asset.width !== expectedPixels
    || asset.height !== expectedPixels
  ) {
    throw new Error(`Invalid or missing runtime icon manifest entry: ${path}`)
  }

  return {
    height: asset.height,
    src: `/${asset.path}`,
    width: asset.width,
  }
}
