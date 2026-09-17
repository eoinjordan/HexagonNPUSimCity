import assert from 'node:assert/strict'
import test from 'node:test'
import { createSim, PRECISIONS, WORKLOADS } from './model.ts'
import { createClock } from './clock.ts'

function advance(sim, steps = 180) {
  for (let step = 0; step < steps; step++) sim.update(1 / 60)
}

test('reset restores every field and the deterministic random sequence', () => {
  const sim = createSim()
  const initial = structuredClone(sim.state)
  advance(sim)
  const firstRun = structuredClone(sim.state)
  sim.setWorkload('vision-conv')
  sim.setPrecision('FP16')
  sim.togglePause()
  sim.reset()
  assert.deepEqual(sim.state, initial)
  advance(sim)
  assert.deepEqual(sim.state, firstRun)
})

test('pause freezes time and all simulated values', () => {
  const sim = createSim()
  advance(sim)
  sim.togglePause()
  const paused = structuredClone(sim.state)
  advance(sim)
  assert.deepEqual(sim.state, paused)
  sim.togglePause()
  sim.update(1 / 60)
  assert.ok(sim.state.t > paused.t)
})

test('invalid deltas cannot corrupt the model and long gaps are bounded', () => {
  const sim = createSim()
  const initial = structuredClone(sim.state)
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) sim.update(delta)
  assert.deepEqual(sim.state, initial)
  sim.update(600)
  assert.equal(sim.state.t, 0.1)
})

test('precision changes refresh metrics even while paused', () => {
  const sim = createSim()
  advance(sim)
  sim.togglePause()
  const utilization = sim.state.util.tensor
  sim.setPrecision('INT4')
  assert.equal(sim.state.tops, 80 * utilization)
  assert.equal(sim.state.tokensPerSec, 95 * utilization)
  assert.equal(sim.state.util.tensor, utilization)
})

test('non-generative workloads do not report token generation', () => {
  const sim = createSim()
  advance(sim)
  assert.ok(sim.state.tokensPerSec > 0)
  for (const workload of ['vision-conv', 'idle']) {
    sim.setWorkload(workload)
    assert.equal(sim.state.tokensPerSec, 0)
  }
})

test('all workload and precision combinations remain finite and bounded', () => {
  for (const workload of WORKLOADS) {
    for (const precision of PRECISIONS) {
      const sim = createSim()
      sim.setWorkload(workload.id)
      sim.setPrecision(precision)
      advance(sim, 600)
      for (const value of [...Object.values(sim.state.util), sim.state.vtcmOccupancy]) {
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
      }
      for (const value of [sim.state.tops, sim.state.tokensPerSec, sim.state.powerWatts, sim.state.microTiles]) {
        assert.ok(Number.isFinite(value) && value >= 0)
      }
      assert.ok(sim.state.powerWatts <= 4.5)
    }
  }
})

test('30, 60, and 144 Hz rendering produce identical simulation states', () => {
  const results = [30, 60, 144].map((refreshRate) => {
    const sim = createSim()
    const clock = createClock(sim.update)
    for (let frame = 0; frame <= refreshRate * 3; frame++) {
      clock.advance(frame * 1000 / refreshRate)
    }
    return structuredClone(sim.state)
  })
  assert.deepEqual(results[0], results[1])
  assert.deepEqual(results[1], results[2])
})

test('the clock discards paused time and bounds background-tab catch-up', () => {
  const sim = createSim()
  const clock = createClock(sim.update)
  clock.advance(0)
  clock.advance(1000 / 60)
  const beforePause = sim.state.t
  clock.advance(60_000, false)
  assert.equal(sim.state.t, beforePause)
  clock.reset()
  clock.advance(120_000)
  assert.equal(sim.state.t, beforePause)
  clock.advance(180_000)
  assert.ok(sim.state.t - beforePause <= 0.1 + 1e-9)
})

test('clock rejects non-finite timestamps and reset drops fractional accumulated time', () => {
  const sim = createSim()
  const clock = createClock(sim.update)
  for (const timestamp of [NaN, Infinity, -Infinity]) assert.equal(clock.advance(timestamp), false)
  assert.equal(clock.advance(0), false)
  assert.equal(clock.advance(10), false)
  clock.reset()
  assert.equal(clock.advance(1000), false)
  assert.equal(clock.advance(1010), false)
  assert.equal(sim.state.t, 0)
  assert.equal(clock.advance(1017), true)
  assert.equal(sim.state.t, 1 / 60)
})

test('all illustrative precision coefficients are applied consistently while paused', () => {
  const sim = createSim()
  advance(sim)
  sim.togglePause()
  const coefficients = { INT4: [80, 95], INT8: [45, 62], INT16: [22, 34], FP16: [20, 30] }
  const activity = sim.state.util.tensor
  for (const [precision, [tops, tokens]] of Object.entries(coefficients)) {
    sim.setPrecision(precision)
    assert.equal(sim.state.tops, tops * activity)
    assert.equal(sim.state.tokensPerSec, tokens * activity)
  }
})

test('idle reduces modeled load and reset preserves state-object identity', () => {
  const sim = createSim()
  const state = sim.state
  const utilization = state.util
  advance(sim, 300)
  const busy = structuredClone(state)
  sim.setWorkload('idle')
  advance(sim, 300)
  assert.equal(state.tokensPerSec, 0)
  assert.ok(state.tops < busy.tops)
  assert.ok(state.powerWatts < busy.powerWatts)
  assert.ok(state.vtcmOccupancy < busy.vtcmOccupancy)
  sim.reset()
  assert.equal(sim.state, state)
  assert.equal(sim.state.util, utilization)
})