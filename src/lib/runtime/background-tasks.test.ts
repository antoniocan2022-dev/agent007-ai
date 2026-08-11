import { describe, expect, test } from 'bun:test'
import { backgroundFire, configureBackgroundDefer, type BackgroundDefer } from './background-tasks'

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

    configureBackgroundDefer((task) => {
      void Promise.resolve(task).catch(() => {})
    })
  })

  test('does not throw when the delegated task rejects', () => {
    expect(() => {
      backgroundFire(Promise.reject(new Error('expected background failure')))
    }).not.toThrow()
  })
})
