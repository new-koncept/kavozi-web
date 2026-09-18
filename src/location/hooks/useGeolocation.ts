import { useEffect, useState } from 'react'
import { errorMessage } from '../../api/locationClient'
import { fixProblem, submitLocation } from '../application/locationService'
import type { LocationMetadata } from '../application/metadata'

export type LocationState = {
  status: 'idle' | 'acquiring' | 'active' | 'denied' | 'unavailable' | 'poor' | 'stale' | 'rejected'
  accuracy?: number
  message?: string
}

export function useGeolocation(id: string | undefined, enabled: boolean, metadata: LocationMetadata, interval: number, attempt = 0) {
  const [state, setState] = useState<LocationState>({ status: 'idle' })
  useEffect(() => {
    if (!enabled || !id) return
    let stopped = false
    let sending = false
    let denied = false
    let latestEvent = 0
    let pending: GeolocationPosition | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let freshnessTimer: ReturnType<typeof setTimeout> | undefined
    const update = (next: LocationState) => { if (!stopped) setState(next) }
    update({ status: 'acquiring' })
    if (!navigator.geolocation) { update({ status: 'unavailable' }); return }
    const flush = async () => {
      if (stopped || sending || !pending) return
      const position = pending
      const event = latestEvent
      pending = undefined
      const problem = fixProblem(position, metadata)
      if (problem) { update({ status: problem, accuracy: position.coords.accuracy }); return }
      sending = true
      try {
        const response = await submitLocation(id, position, metadata)
        if (stopped) return
        if ('wait' in response) {
          pending ??= position
          timer = setTimeout(() => { timer = undefined; void flush() }, response.wait)
        } else {
          if (event === latestEvent) update({ status: 'active', accuracy: position.coords.accuracy })
          clearTimeout(freshnessTimer)
          freshnessTimer = setTimeout(() => update({ status: 'stale', accuracy: position.coords.accuracy }),
            Math.max(1, position.timestamp + metadata.locationFreshnessSeconds * 1000 - Date.now()))
        }
      } catch (error) { if (event === latestEvent) update({ status: 'rejected', message: errorMessage(error), accuracy: position.coords.accuracy }) }
      finally {
        sending = false
        if (!stopped && pending && !timer) timer = setTimeout(() => { timer = undefined; void flush() }, interval * 1000)
      }
    }
    const onPosition = (position: GeolocationPosition) => {
      if (stopped) return
      latestEvent++
      denied = false
      const problem = fixProblem(position, metadata)
      if (problem) {
        pending = undefined
        clearTimeout(timer); timer = undefined
        clearTimeout(freshnessTimer)
        update({ status: problem, accuracy: position.coords.accuracy }); return
      }
      pending = position
      if (!timer) void flush()
    }
    const onError = (error: GeolocationPositionError) => {
      latestEvent++
      denied = error.code === 1
      pending = undefined
      clearTimeout(timer); timer = undefined
      clearTimeout(freshnessTimer)
      update({ status: error.code === 1 ? 'denied' : 'unavailable' })
    }
    const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    const watch = navigator.geolocation.watchPosition(onPosition, onError, options)
    // Watches need not emit while stationary. Ask for a fresh fix at the server's cadence.
    const refresh = setInterval(() => {
      if (!stopped && !denied) navigator.geolocation.getCurrentPosition(onPosition, onError, options)
    }, interval * 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
      clearTimeout(freshnessTimer)
      clearInterval(refresh)
      navigator.geolocation.clearWatch(watch)
    }
  }, [enabled, id, metadata, interval, attempt])
  return enabled && id ? state : { status: 'idle' as const }
}
