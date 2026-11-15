import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'

export interface OidcConfig {
  configured: boolean
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  adminGroup: string
  adminUsers: string[]
}

export interface TripApiOptions {
  oidc?: OidcConfig
  secureCookie?: boolean
}

export function openTripDatabase(databasePath?: string): DatabaseSync

export function createTripApi(
  database: DatabaseSync,
  options?: TripApiOptions,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>


export function walkApi(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void>
