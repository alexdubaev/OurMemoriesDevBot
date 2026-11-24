import { useState } from 'react'
import { ru } from 'date-fns/locale'
import type { RefObject } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { Typography } from '@/components/typography'
import { calendarCivilDate, familyCivilDate, isCivilDateAvailable, type FeedDatePeriod } from './date-period'

const modes = [
  ['year', 'Год'], ['month', 'Месяц'], ['range', 'Диапазон'], ['day', 'День'],
] as const
const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, index, 1))))

export function DatePeriodSheet({ active, familyTimezone, onApply, onOpenChange, open, period, returnFocusRef }: {
  active: boolean; familyTimezone: string; onApply: (period: FeedDatePeriod) => void
  onOpenChange: (open: boolean) => void; open: boolean; period: FeedDatePeriod | null
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const today = familyCivilDate(familyTimezone)
  const [mode, setMode] = useState<FeedDatePeriod['mode']>(period?.mode ?? 'year')
  const currentYear = Number(today.slice(0, 4)); const currentMonth = Number(today.slice(5, 7))
  const initial = period ?? { mode: 'year' as const, year: currentYear }
  const [year, setYear] = useState(initial.mode === 'year' || initial.mode === 'month' ? initial.year : currentYear)
  const [month, setMonth] = useState(initial.mode === 'month' ? initial.month : currentMonth)
  const [fromYear, setFromYear] = useState(initial.mode === 'range' ? initial.fromYear : currentYear)
  const [fromMonth, setFromMonth] = useState(initial.mode === 'range' ? initial.fromMonth : currentMonth)
  const [toYear, setToYear] = useState(initial.mode === 'range' ? initial.toYear : currentYear)
  const [toMonth, setToMonth] = useState(initial.mode === 'range' ? initial.toMonth : currentMonth)
  const [selectedDay, setSelectedDay] = useState(initial.mode === 'day' ? initial.date : today)
  const reversed = mode === 'range' && fromYear * 12 + fromMonth > toYear * 12 + toMonth
  const selectedDayAvailable = isCivilDateAvailable(selectedDay, familyTimezone)
  const invalidYear = (mode === 'year' && !validYear(year, currentYear)) ||
    (mode === 'month' && !validYear(year, currentYear)) ||
    (mode === 'range' && (!validYear(fromYear, currentYear) || !validYear(toYear, currentYear)))
  const apply = () => {
    if (reversed || invalidYear || (mode === 'day' && !selectedDayAvailable)) return
    if (mode === 'year') onApply({ mode, year })
    else if (mode === 'month') onApply({ mode, year, month })
    else if (mode === 'range') onApply({ mode, fromYear, fromMonth, toYear, toMonth })
    else onApply({ mode, date: selectedDay })
    onOpenChange(false)
  }
  return <MemolyBottomSheet onOpenChange={onOpenChange} open={active && open} returnFocusRef={returnFocusRef}>
    <section className="feed-date-sheet">
      <DrawerTitle className="text-lg font-semibold">Даты в ленте</DrawerTitle>
      <DrawerDescription>Выберите период воспоминаний</DrawerDescription>
      <Tabs className="feed-date-tabs" onValueChange={(value) => setMode(value as FeedDatePeriod['mode'])} value={mode}>
        <TabsList aria-label="Тип периода" className="feed-date-modes">
          {modes.map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="year"><label className="feed-date-field">Год<input aria-label="Год" max={currentYear} min="1900" onChange={(event) => setYear(Number(event.target.value))} type="number" value={year} /></label></TabsContent>
        <TabsContent value="month"><div className="feed-date-fields"><label className="feed-date-field">Месяц<select aria-label="Месяц" onChange={(event) => setMonth(Number(event.target.value))} value={month}>{monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label className="feed-date-field">Год<input aria-label="Год" max={currentYear} min="1900" onChange={(event) => setYear(Number(event.target.value))} type="number" value={year} /></label></div></TabsContent>
        <TabsContent value="range"><div className="feed-date-range">{([[fromMonth, fromYear, setFromMonth, setFromYear, 'С'] as const, [toMonth, toYear, setToMonth, setToYear, 'По'] as const]).map(([monthValue, yearValue, setMonthValue, setYearValue, label]) => <fieldset className="feed-date-fields" key={label}><legend>{label}</legend><label className="feed-date-field">Месяц<select aria-label={`${label} месяц`} onChange={(event) => setMonthValue(Number(event.target.value))} value={monthValue}>{monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label className="feed-date-field">Год<input aria-label={`${label} год`} max={currentYear} min="1900" onChange={(event) => setYearValue(Number(event.target.value))} type="number" value={yearValue} /></label></fieldset>)}</div></TabsContent>
        <TabsContent value="day"><Calendar aria-label="Выберите день" captionLayout="dropdown" disabled={(date) => !isCivilDateAvailable(calendarCivilDate(date), familyTimezone)} endMonth={new Date(`${today.slice(0, 7)}-01T12:00:00`)} labels={{ labelMonthDropdown: () => 'Месяц', labelYearDropdown: () => 'Год', labelPrevious: () => 'Предыдущий месяц', labelNext: () => 'Следующий месяц' }} locale={ru} mode="single" onSelect={(date) => { if (date) setSelectedDay(calendarCivilDate(date)) }} selected={new Date(`${selectedDay}T12:00:00`)} startMonth={new Date('1900-01-01T12:00:00')} weekStartsOn={1} /></TabsContent>
      </Tabs>
      {reversed ? <Typography as="p" className="feed-date-error" role="alert" variant="bodySm">Начальный месяц должен быть раньше конечного.</Typography> : null}
      {invalidYear ? <Typography as="p" className="feed-date-error" role="alert" variant="bodySm">Укажите год от 1900 до текущего.</Typography> : null}
      <div className="feed-date-actions"><Button onClick={() => onOpenChange(false)} type="button" variant="outline">Отмена</Button><Button disabled={reversed || invalidYear || (mode === 'day' && !selectedDayAvailable)} onClick={apply} type="button">Показать</Button></div>
    </section>
  </MemolyBottomSheet>
}

function validYear(year: number, currentYear: number) { return Number.isInteger(year) && year >= 1900 && year <= currentYear }
