import type { UserDto } from '@web-app-demo/contracts'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Typography } from '@/components/typography'
import { CurrentUserAvatarControls } from './CurrentUserAvatarControls'

export function AvatarPanel({ user }: { user: UserDto }) {
  return <Card>
    <CardHeader>
      <Typography as="h2" variant="h6">Profile photo</Typography>
      <CardDescription>Shown next to your name across the workspace. Only you can see the original file.</CardDescription>
    </CardHeader>
    <CardContent><CurrentUserAvatarControls displayName={user.displayName} email={user.email} /></CardContent>
  </Card>
}
