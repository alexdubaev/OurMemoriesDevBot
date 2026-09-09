declare module 'heic-decode' {
  type DecodedImage = { width: number; height: number; data: Uint8ClampedArray }
  export default function decode(input: { buffer: Uint8Array }): Promise<DecodedImage>
}
