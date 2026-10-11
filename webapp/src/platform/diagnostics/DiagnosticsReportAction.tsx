import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'

export function DiagnosticsReportAction() {
  const [fallback, setFallback] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyReport = async () => {
    const report = window.__MEMOLY_DIAGNOSTICS__?.report() ?? '{"error":"report-unavailable"}'
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setFallback(null)
    } catch {
      setCopied(false)
      setFallback(report)
    }
  }

  return <div className="grid gap-3">
    <Button className="min-h-12 w-full" onClick={() => void copyReport()} type="button">
      <Typography variant="memoryButton">{copied ? 'Отчёт скопирован' : 'Скопировать отчёт об ошибке'}</Typography>
    </Button>
    {fallback !== null ? <textarea aria-label="Отчёт об ошибке для ручного копирования" className="min-h-36 w-full select-text rounded-xl border bg-background p-3 text-left" onFocus={(event) => event.currentTarget.select()} readOnly value={fallback} /> : null}
  </div>
}
