const privateMediaContentPath = /^\/api\/v1\/families\/[0-9a-f-]+\/media\/(?:[0-9a-f-]+|max-videos\/[0-9a-f-]+)\/content$/i

/**
 * The media content endpoint authenticates with either a Bearer token or its
 * short-lived HttpOnly playback cookie. Other family routes remain Bearer-only.
 */
export function bypassesFamilyBearerAuth(method: string, path: string) {
  return (method === 'GET' || method === 'HEAD') && privateMediaContentPath.test(path.split('?', 1)[0])
}
