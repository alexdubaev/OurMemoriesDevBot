import { resolveComposerFile, validateSize, verifyComposerFile } from '@/features/composer'
import { uploadFamilyPhoto, type FamilyPhotoUploadResume } from '@/features/family'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { InvalidMonthPhoto } from './month-photo-queue'

export async function uploadAlbumPhoto(transport: AuthenticatedTransport, familyId: string, file: File, key: string, resume: FamilyPhotoUploadResume, signal: AbortSignal, progress: (loaded: number, total: number) => void) {
  if (file.type.startsWith('video/') || resolveComposerFile(file)?.kind === 'video') throw new InvalidMonthPhoto('Здесь можно добавлять только фотографии.')
  const media = await verifyComposerFile(file)
  signal.throwIfAborted()
  if (media?.kind !== 'photo') throw new InvalidMonthPhoto('Файл не распознан как фотография. Подойдут JPG, PNG, WebP, HEIC и HEIF.')
  const size = validateSize(file, media)
  if (!size.ok) throw new InvalidMonthPhoto(size.code === 'too_large_photo' ? 'Размер фотографии превышает 20 МБ.' : 'Файл слишком маленький или имеет неподдерживаемый формат.')
  try {
    return await uploadFamilyPhoto(transport, familyId, file, media.contentType as Parameters<typeof uploadFamilyPhoto>[3], 'memory', signal, undefined, key, progress, undefined, resume)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 410) throw new InvalidMonthPhoto('Срок загрузки истёк. Выберите этот файл заново.')
    throw error
  }
}
