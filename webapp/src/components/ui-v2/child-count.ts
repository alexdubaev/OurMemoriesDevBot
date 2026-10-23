/** «2 ребёнка», «5 детей», «21 ребёнок». */
export function childCountLabel(count: number) {
  const remainder10 = count % 10
  const remainder100 = count % 100
  if (remainder10 === 1 && remainder100 !== 11) return `${count} ребёнок`
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) return `${count} ребёнка`
  return `${count} детей`
}
