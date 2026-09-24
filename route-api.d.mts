import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'

export function openTripDatabase(databasePath?: string): DatabaseSync

export function createTripApi(
  database: DatabaseSync,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>

export function walkApi(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void>
