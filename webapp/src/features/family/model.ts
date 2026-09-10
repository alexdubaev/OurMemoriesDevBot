export function ageFromBirthDate(birthDate: string, now = new Date()) {
  const [year, month, day] = birthDate.split('-').map(Number)
  if (!year || !month || !day) return null
  let age = now.getFullYear() - year
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1
  return age >= 0 ? age : null
}

export function roleLabel(role: 'full' | 'viewer', isOwner: boolean) {
  if (isOwner) return 'Владелец'
  return role === 'full' ? 'Полный доступ' : 'Просмотр'
}

export function familyMemberName(member: { displayName: string | null; familyDisplayName: string | null }) {
  return member.familyDisplayName ?? member.displayName ?? 'Участник семьи'
}
