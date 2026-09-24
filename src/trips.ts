export type Stop = {
  id: string
  name: string
  address: string
  time: string
  duration: number
  durationMax?: number
  notes?: string
  coordinates: string
}

export type Traveler = { id: string; name: string; outbound: string; inbound: string }
export type Flight = {
  airline: string
  number: string
  departureTime: string
  departureAirport: string
  departureTerminal: string
  arrivalTime: string
  arrivalAirport: string
  arrivalTerminal: string
}
export type Trip = {
  id: string
  title: string
  destination: string
  country: string
  startDate: string
  endDate: string
  timeZone: string
  description: string
  hotelName: string
  hotelAddress: string
  hotelCoordinates?: string
  days: Record<string, Stop[]>
  travelers: Traveler[]
  outboundFlight?: Flight
  returnFlight?: Flight
  carryOnKg?: number
  checkedBagKg?: number
  personalItemPieces?: number
  carryOnPieces?: number
  checkedBagPieces?: number
}
export type TripWorkspace = { trips: Trip[]; activeTripId: string }

const workspaceKey = 'travel-planner-v1'

export function listDates(startDate: string, endDate: string): string[] {
  if (!isDate(startDate) || !isDate(endDate) || endDate < startDate) return []
  const dates: string[] = []
  const current = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStop(value: unknown): value is Stop {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.address === 'string' && typeof value.coordinates === 'string' &&
    typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
    typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 &&
    (value.durationMax === undefined ||
      (typeof value.durationMax === 'number' && Number.isFinite(value.durationMax) && value.durationMax >= value.duration)) &&
    (value.notes === undefined || typeof value.notes === 'string')
}

function isTraveler(value: unknown): value is Traveler {
  return isRecord(value) &&
    ['id', 'name', 'outbound', 'inbound'].every((key) => typeof value[key] === 'string')
}

function isFlight(value: unknown): value is Flight {
  return isRecord(value) &&
    ['airline', 'number', 'departureTime', 'departureAirport', 'departureTerminal', 'arrivalTime', 'arrivalAirport', 'arrivalTerminal']
      .every((key) => typeof value[key] === 'string')
}

export function isTrip(value: unknown): value is Trip {
  if (!isRecord(value) ||
    typeof value.id !== 'string' || !value.id ||
    typeof value.title !== 'string' || !value.title.trim() ||
    typeof value.destination !== 'string' || !value.destination.trim() ||
    typeof value.country !== 'string' ||
    !isDate(value.startDate) || !isDate(value.endDate) || value.endDate < value.startDate ||
    typeof value.timeZone !== 'string' || !value.timeZone ||
    typeof value.description !== 'string' || typeof value.hotelName !== 'string' ||
    typeof value.hotelAddress !== 'string' ||
    !Array.isArray(value.travelers) || !value.travelers.every(isTraveler)) return false
  if (!isRecord(value.days)) return false
  const days = value.days

  const expectedDates = listDates(value.startDate, value.endDate)
  const actualDates = Object.keys(days)
  if (expectedDates.length !== actualDates.length ||
    expectedDates.some((date) => {
      const day = days[date]
      return !Array.isArray(day) || !day.every(isStop)
    })) return false
  if (value.hotelCoordinates !== undefined && typeof value.hotelCoordinates !== 'string') return false
  if (value.outboundFlight !== undefined && !isFlight(value.outboundFlight)) return false
  if (value.returnFlight !== undefined && !isFlight(value.returnFlight)) return false
  if (value.carryOnKg !== undefined && (typeof value.carryOnKg !== 'number' || !Number.isFinite(value.carryOnKg))) return false
  if (value.checkedBagKg !== undefined && (typeof value.checkedBagKg !== 'number' || !Number.isFinite(value.checkedBagKg))) return false
  if ([value.personalItemPieces, value.carryOnPieces, value.checkedBagPieces].some((pieces) =>
    pieces !== undefined && (typeof pieces !== 'number' || !Number.isInteger(pieces) || pieces < 0))) return false
  return true
}

export function isWorkspace(value: unknown): value is TripWorkspace {
  if (!isRecord(value) || !Array.isArray(value.trips) || value.trips.length === 0 ||
    !value.trips.every(isTrip) || typeof value.activeTripId !== 'string') return false
  return new Set(value.trips.map((trip) => trip.id)).size === value.trips.length &&
    value.trips.some((trip) => trip.id === value.activeTripId)
}

export function defineTrip(input: {
  id: string
  title: string
  destination: string
  country?: string
  startDate: string
  endDate: string
  timeZone: string
  description?: string
  hotelName?: string
  hotelAddress?: string
  hotelCoordinates?: string
  days?: Record<string, Stop[]>
  travelers?: Traveler[]
  outboundFlight?: Flight
  returnFlight?: Flight
  carryOnKg?: number
  checkedBagKg?: number
  personalItemPieces?: number
  carryOnPieces?: number
  checkedBagPieces?: number
}): Trip {
  const trip: Trip = {
    id: input.id,
    title: input.title.trim(),
    destination: input.destination.trim(),
    country: input.country?.trim() ?? '',
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone.trim(),
    description: input.description ?? '',
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
  if (!isTrip(trip)) throw new Error('旅程資料無效，請檢查日期、唯一 ID 和欄位格式。')
  try {
    new Intl.DateTimeFormat('zh-TW', { timeZone: trip.timeZone })
  } catch {
    throw new Error(`旅程「${trip.title}」使用了無效的 IANA 時區：${trip.timeZone}`)
  }
  return trip
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'>): TripWorkspace | null {
  const raw = storage.getItem(workspaceKey)
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('舊版本機旅程資料不是有效 JSON；原有資料未被修改。')
  }
  if (!isWorkspace(value)) throw new Error('舊版本機旅程資料格式不正確；原有資料未被修改。')
  return value
}
