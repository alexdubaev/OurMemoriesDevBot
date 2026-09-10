import { Skeleton } from '@/components/ui/skeleton'

export function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка ленты" className="flex flex-col gap-8" data-slot="feed-skeleton">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3 w-28 max-w-[70%]" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[72%]" />
      </div>
      <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
    </div>
  )
}
