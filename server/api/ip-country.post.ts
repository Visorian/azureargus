import { createIpCountryHandler } from '../utils/ipCountryHandler'

export default defineEventHandler(createIpCountryHandler({ getRuntimeConfig: useRuntimeConfig }))
