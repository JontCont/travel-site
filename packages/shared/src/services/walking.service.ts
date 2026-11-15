import type { WalkLeg } from '../models/walking.ts'

export function evaluateWalk(
  legs: WalkLeg[],
  maxLegMinutes: number,
  maxDayMinutes: number,
  expectedLegs: number,
): 'unverified' | 'over' | 'within' {
  if (
    !Number.isFinite(maxLegMinutes) || maxLegMinutes <= 0 ||
    !Number.isFinite(maxDayMinutes) || maxDayMinutes <= 0 ||
    legs.length !== expectedLegs ||
    legs.some((leg) => !Number.isFinite(leg.minutes) || leg.minutes < 0 || !Number.isFinite(leg.meters) || leg.meters < 0)
  ) return 'unverified'
  if (legs.some((leg) => leg.minutes > maxLegMinutes) ||
    legs.reduce((total, leg) => total + leg.minutes, 0) > maxDayMinutes) return 'over'
  return 'within'
}
