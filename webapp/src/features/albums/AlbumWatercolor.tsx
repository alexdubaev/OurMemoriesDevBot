/** Genuine paper-backed artwork from the approved first watercolor reference. */
export function AlbumWatercolor({ name, className = '', lazy = false }: { name: 'palette' | 'bear' | 'rabbit' | 'sprig'; className?: string; lazy?: boolean }) {
  const sizes = { palette: [166, 142], bear: [222, 129], rabbit: [190, 166], sprig: [73, 63] } as const
  return <img alt="" aria-hidden className={`albums-watercolor-art ${className}`} height={sizes[name][1]} loading={lazy ? 'lazy' : undefined} src={`/assets/albums/watercolor-${name}.v1.webp`} width={sizes[name][0]} />
}

export function AlbumWatercolorFooter() {
  return <div aria-hidden className="albums-watercolor-footer"><AlbumWatercolor className="albums-footer-sprig" lazy name="sprig" /><AlbumWatercolor className="albums-footer-rabbit" lazy name="rabbit" /></div>
}
