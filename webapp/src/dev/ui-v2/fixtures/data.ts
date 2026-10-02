import portrait from '../assets/portrait.webp'
import familyPhoto from '../assets/family.webp'
import painting from '../assets/painting.webp'
import fatherDaughter from '../assets/father-daughter.webp'
import type { FamilyHeroModel, InviteModel, MemoryCardModel, PersonModel } from './models'
export const photos = { portrait, family: familyPhoto, painting }
export const family: FamilyHeroModel = { name: 'Лилия', age: '3 года · столько открытий впереди', familyName: 'История Лилии', avatar: portrait, birthDate: '2023-09-12', sex: 'female', timezone: 'Europe/Moscow' }
export const people: PersonModel[] = [
  { id: 'mama', name: 'Мама', initials: 'М', subtitle: 'Владелец семьи', owner: true, role: 'owner' },
  { id: 'papa', name: 'Папа', initials: 'П', subtitle: 'Полный доступ', role: 'full', avatar: fatherDaughter },
  { id: 'grandma', name: 'Бабушка', initials: 'Б', subtitle: 'Просмотр', role: 'viewer' },
  { id: 'grandpa', name: 'Дедушка', initials: 'Д', subtitle: 'Просмотр', role: 'viewer' },
]
export const demoInvite: InviteModel = { name: 'Бабушка', role: 'viewer', expires: '9 октября 2026', url: 'https://demo.invalid/invite/synthetic-memoly' }
export const allowedReactions = ['❤️', '🥰', '😂', '🥹', '😮', '👏'] as const
export const memories: MemoryCardModel[] = [
  { id: 'photo', kind: 'media', author: people[1], date: 'Сегодня, 10:24', body: 'Моя маленькая радость 💕\nСпасибо, что ты у нас есть, Лилия!', media: [{ kind: 'photo', src: fatherDaughter, alt: 'Папа целует смеющуюся Лилию на прогулке', orientation: 'landscape' }], unread: true, reactions: [{ emoji: '🥰', count: 3 }, { emoji: '❤️', count: 2 }] },
  { id: 'mixed', kind: 'media', author: people[1], date: 'Вчера, 16:40', body: 'Обычный вечер, который хочется запомнить. Гуляли до самого заката.', media: [{ kind: 'photo', src: familyPhoto, alt: 'Семейная прогулка в парке', orientation: 'landscape' }, { kind: 'video', src: painting, alt: 'Наш маленький художник', orientation: 'landscape', duration: '0:24', provider: 'MAX', status: 'ready' }, { kind: 'photo', src: portrait, alt: 'Объятия после прогулки', orientation: 'portrait' }], reactions: [{ emoji: '❤️', count: 4 }] },
  { id: 'note', kind: 'note', author: people[0], date: 'Вчера, 09:15', body: '«Мама, а если обнять дерево, оно тоже станет нашей семьёй?»\n\nСегодня у нас появилась ещё одна причина чаще гулять.', media: [], reactions: [{ emoji: '🥹', count: 3 }] },
  { id: 'voice', kind: 'voice', author: people[2], date: '30 сентября, 19:02', body: 'Бабушкина сказка перед сном. Пусть этот голос всегда будет рядом.', media: [], reactions: [{ emoji: '❤️', count: 2 }], voice: { duration: 42, peaks: Array.from({ length: 40 }, (_, i) => 12 + ((i * 17 + i * i * 3) % 28)) } },
  { id: 'video', kind: 'media', author: people[1], date: '30 сентября, 12:30', body: 'Первый домик, который нарисовала сама. И обязательно большое солнце!', media: [{ kind: 'video', src: painting, alt: 'Лилия рисует домик', orientation: 'landscape', duration: '0:24', status: 'ready', provider: 'MAX' }], reactions: [] },
]
