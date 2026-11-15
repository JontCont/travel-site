export type TripStatus = 'scheduled' | 'in-progress' | 'ended'

export function isLocalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export function listDates(startDate: string, endDate: string): string[] {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || endDate < startDate) return []
  const dates: string[] = []
  const current = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

export function getTripStatus(
  startDate: string,
  endDate: string,
  timeZone: string,
  now = new Date(),
): TripStatus {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const localDate = `${value('year')}-${value('month')}-${value('day')}`
  if (localDate < startDate) return 'scheduled'
  if (localDate > endDate) return 'ended'
  return 'in-progress'
}

export function sortTripsNearToFar<T extends { startDate: string; endDate: string; timeZone: string }>(
  trips: T[],
  now = new Date(),
): T[] {
  const order: Record<TripStatus, number> = { 'in-progress': 0, scheduled: 1, ended: 2 }
  return [...trips].sort((left, right) => {
    const leftStatus = getTripStatus(left.startDate, left.endDate, left.timeZone, now)
    const rightStatus = getTripStatus(right.startDate, right.endDate, right.timeZone, now)
    if (leftStatus !== rightStatus) return order[leftStatus] - order[rightStatus]
    if (leftStatus === 'ended') return right.endDate.localeCompare(left.endDate)
    return left.startDate.localeCompare(right.startDate)
  })
}
