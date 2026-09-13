export function shouldShowChildAvatarImage({ avatarUrl, imageFailed }: { avatarUrl: string | null; imageFailed: boolean }) {
  return Boolean(avatarUrl) && !imageFailed
}
