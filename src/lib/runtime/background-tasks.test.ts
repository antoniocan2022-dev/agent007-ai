import { afterEach, describe, expect, test } from 'bun:test'
import { backgroundFire, configureBackgroundDefer, type BackgroundDefer } from './background-tasks'

const defaultDefer: BackgroundDefer = (task) => {
  void Promise.resolve(task).catch(() => {})
}

afterEach(() => {
  configureBackgroundDefer(defaultDefer)
})

describe('hosting-neutral background task boundary', () => {
  test('delegates background lifetime to the registered runtime adapter', async () => {
    let captured: Promise<unknown> | undefined
    const handler: BackgroundDefer = (task) => {
      captured = Promise.resolve(task)
    }

    configureBackgroundDefer(handler)

    const observed: string[] = []
    backgroundFire(Promise.resolve().then(() => {
      observed.push('executed')
    }))

    expect(captured).toBeDefined()
    await captured
    expect(observed).toEqual(['executed'])
  })

  test('does not throw when the delegated task rejects', () => {
    expect(() => {
      backgroundFire(Promise.reject(new Error('expected background failure')))
    }).not.toThrow()
  })
})
