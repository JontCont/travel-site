import type { Flight, Stop, Traveler, Trip, TripWorkspace } from '../models/trip.ts'
import { isLocalDate, listDates } from '../services/date.service.ts'

export type StopDto = Stop
export type TravelerDto = Traveler
export type FlightDto = Flight
export type TripDto = Trip
export type TripWorkspaceDto = TripWorkspace

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStop(value: unknown): value is StopDto {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.address === 'string' && typeof value.coordinates === 'string' &&
    typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
    typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 &&
    (value.durationMax === undefined ||
      (typeof value.durationMax === 'number' && Number.isFinite(value.durationMax) && value.durationMax >= value.duration)) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.openingHours === undefined || typeof value.openingHours === 'string') &&
    (value.openingHoursStatus === undefined || value.openingHoursStatus === 'unverified' || value.openingHoursStatus === 'confirmed') &&
    (value.openingHoursSource === undefined || typeof value.openingHoursSource === 'string') &&
    (value.openingHoursCheckedAt === undefined ||
      (typeof value.openingHoursCheckedAt === 'string' && isLocalDate(value.openingHoursCheckedAt)))
}

function isTraveler(value: unknown): value is TravelerDto {
  return isRecord(value) &&
    ['id', 'name', 'outbound', 'inbound'].every((key) => typeof value[key] === 'string')
}

function isFlight(value: unknown): value is FlightDto {
  return isRecord(value) &&
    ['airline', 'number', 'departureTime', 'departureAirport', 'departureTerminal', 'arrivalTime', 'arrivalAirport', 'arrivalTerminal']
      .every((key) => typeof value[key] === 'string')
}

export function isTripDto(value: unknown): value is TripDto {
  if (!isRecord(value) ||
    typeof value.id !== 'string' || !value.id ||
    typeof value.title !== 'string' || !value.title.trim() ||
    typeof value.destination !== 'string' || !value.destination.trim() ||
    typeof value.country !== 'string' ||
    !isLocalDate(value.startDate) || !isLocalDate(value.endDate) || value.endDate < value.startDate ||
    typeof value.timeZone !== 'string' || !value.timeZone ||
    typeof value.description !== 'string' || typeof value.hotelName !== 'string' ||
    typeof value.hotelAddress !== 'string' ||
    (value.notepad !== undefined && typeof value.notepad !== 'string') ||
    !Array.isArray(value.travelers) || !value.travelers.every(isTraveler) ||
    !isRecord(value.days)) return false
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

export function isTripWorkspaceDto(value: unknown): value is TripWorkspaceDto {
  if (!isRecord(value) || !Array.isArray(value.trips) || value.trips.length === 0 ||
    !value.trips.every(isTripDto) || typeof value.activeTripId !== 'string') return false
  return new Set(value.trips.map((trip) => trip.id)).size === value.trips.length &&
    value.trips.some((trip) => trip.id === value.activeTripId)
}
