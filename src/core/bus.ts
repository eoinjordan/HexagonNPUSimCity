/** A minimal typed publish/subscribe bus wiring the UI to the world. */
export type BusEvents = {
  'district:select': { id: string | null }
  'district:hover': { id: string | null }
  'workload:change': { id: string }
  'precision:change': { value: string }
  'camera:focus': { id: string }
  'camera:home': void
  'tour:toggle': void
  'help:toggle': void
  'settings:toggle': void
  'getapp:toggle': void
  'pause:toggle': void
  'theme:toggle': void
  'overlay:dismiss': void
  reset: void
}

type Handler<T> = (payload: T) => void

export interface Bus {
  on<K extends keyof BusEvents>(type: K, fn: Handler<BusEvents[K]>): () => void
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void
}

export function createBus(): Bus {
  const map = new Map<keyof BusEvents, Set<Handler<never>>>()
  return {
    on(type, fn) {
      let set = map.get(type)
      if (!set) {
        set = new Set()
        map.set(type, set)
      }
      set.add(fn as Handler<never>)
      return () => set!.delete(fn as Handler<never>)
    },
    emit(type, payload) {
      const set = map.get(type)
      if (!set) return
      for (const fn of set) (fn as Handler<BusEvents[typeof type]>)(payload)
    },
  }
}
