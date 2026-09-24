import { isTripDto } from '../dto/trip-workspace.dto.ts'
import type { DefineTripInput, Trip } from '../models/trip.ts'
import { listDates } from './date.service.ts'

export { listDates } from './date.service.ts'

export function defineTrip(input: DefineTripInput): Trip {
  const trip: Trip = {
    id: input.id,
    title: input.title.trim(),
    destination: input.destination.trim(),
    country: input.country?.trim() ?? '',
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone.trim(),
    description: input.description ?? '',
    ...(input.notepad !== undefined ? { notepad: input.notepad } : {}),
    hotelName: input.hotelName ?? '',
    hotelAddress: input.hotelAddress ?? '',
    ...(input.hotelCoordinates ? { hotelCoordinates: input.hotelCoordinates } : {}),
    days: Object.fromEntries(listDates(input.startDate, input.endDate)
      .map((date) => [date, input.days?.[date] ?? []])),
    travelers: input.travelers ?? [],
    ...(input.outboundFlight ? { outboundFlight: input.outboundFlight } : {}),
    ...(input.returnFlight ? { returnFlight: input.returnFlight } : {}),
    ...(input.carryOnKg !== undefined ? { carryOnKg: input.carryOnKg } : {}),
    ...(input.checkedBagKg !== undefined ? { checkedBagKg: input.checkedBagKg } : {}),
    ...(input.personalItemPieces !== undefined ? { personalItemPieces: input.personalItemPieces } : {}),
    ...(input.carryOnPieces !== undefined ? { carryOnPieces: input.carryOnPieces } : {}),
    ...(input.checkedBagPieces !== undefined ? { checkedBagPieces: input.checkedBagPieces } : {}),
  }
  if (!isTripDto(trip)) throw new Error('旅程資料無效，請檢查日期、唯一 ID 和欄位格式。')
  try {
    new Intl.DateTimeFormat('zh-TW', { timeZone: trip.timeZone })
  } catch {
    throw new Error(`旅程「${trip.title}」使用了無效的 IANA 時區：${trip.timeZone}`)
  }
  return trip
}
