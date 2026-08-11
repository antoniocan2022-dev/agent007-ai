import { afterEach, describe, expect, test } from 'bun:test'
import { backgroundFire, configureBackgroundDefer, type BackgroundDefer } from './background-tasks'

const defaultDefer: BackgroundDefer = (task) => {
  void Promise.resolve(task).catch(() => {})
}

afterEach(() => configureBackgroundDefer(defaultDefer))

describe('hosting-neutral background task boundary', () => {
  test('delegates task lifetime to the registered runtime adapter', async () => {
    let captured: Promise<unknown> | undefined
    configureBackgroundDefer((task) => { captured = Promise.resolve(task) })

    const observed: string[] = []
    backgroundFire(Promise.resolve().then(() => { observed.push('executed') }))

    expect(captured).toBeDefined()
    await captured
    expect(observed).toEqual(['executed'])
  })

  test('swallows background task rejection at the boundary', () => {
    expect(() => backgroundFire(Promise.reject(new Error('expected')))).not.toThrow()
  })
})
