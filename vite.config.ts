import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createTripApi, openTripDatabase, walkApi } from './route-api.mjs'

const tripDatabase = openTripDatabase()
const tripApi = createTripApi(tripDatabase)

export default defineConfig({
  plugins: [react(), {
    name: 'local-trip-data',
    configureServer(server) {
      server.middlewares.use(tripApi)
      server.middlewares.use(walkApi)
      server.httpServer?.once('close', () => tripDatabase.close())
    },
    configurePreviewServer(server) {
      server.middlewares.use(tripApi)
      server.middlewares.use(walkApi)
    },
  }],
})
