import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createTripApi, openTripDatabase, walkApi } from './route-api.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['TRIP_'])
  const tripDatabase = openTripDatabase(env.TRIP_DATABASE_PATH)
  for (const key of ['TRIP_VIEW_CODE', 'TRIP_ADMIN_CODE', 'TRIP_COOKIE_SECURE']) {
    if (env[key] !== undefined) process.env[key] = env[key]
  }
  if (mode === 'production' && process.env.TRIP_COOKIE_SECURE !== '0') process.env.TRIP_COOKIE_SECURE = '1'
  const tripApi = createTripApi(tripDatabase)

  return {
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
  }
})
