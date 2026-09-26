export type Stop = {
  id: string
  name: string
  address: string
  time: string
  duration: number
  durationMax?: number
  notes?: string
  coordinates: string
  openingHours?: string
  openingHoursStatus?: 'unverified' | 'confirmed'
  openingHoursSource?: string
  openingHoursCheckedAt?: string
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
  notepad?: string
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

export type DefineTripInput = {
  id: string
  title: string
  destination: string
  country?: string
  startDate: string
  endDate: string
  timeZone: string
  description?: string
  notepad?: string
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
}
