import { registerManagedEventHubStream } from '../../server/utils/managedEventHubStreamRegistry'

describe('managed Event Hub stream registry', () => {
  it("serializes replacements and protects the newest owner's entry", async () => {
    let finishFirst!: () => void
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const closeFirst = vi.fn<() => Promise<void>>(async () => {
      await firstFinished
    })
    const closeSecond = vi.fn<() => Promise<void>>(async () => {})
    const unregisterFirst = await registerManagedEventHubStream('session', closeFirst)

    let secondRegistered = false
    const registeringSecond = (async () => {
      const unregister = await registerManagedEventHubStream('session', closeSecond)
      secondRegistered = true
      return unregister
    })()
    await vi.waitFor(() => {
      expect(closeFirst).toHaveBeenCalledOnce()
    })
    expect(secondRegistered).toBe(false)

    finishFirst()
    const unregisterSecond = await registeringSecond
    unregisterFirst()

    const unregisterThird = await registerManagedEventHubStream(
      'session',
      vi.fn<() => Promise<void>>(async () => {}),
    )
    expect(closeSecond).toHaveBeenCalledOnce()

    unregisterSecond()
    unregisterThird()
  })

  it('keeps different sessions independent', async () => {
    const closeFirst = vi.fn<() => Promise<void>>(async () => {})
    const closeSecond = vi.fn<() => Promise<void>>(async () => {})

    const unregisterFirst = await registerManagedEventHubStream('first', closeFirst)
    const unregisterSecond = await registerManagedEventHubStream('second', closeSecond)
    expect(closeFirst).not.toHaveBeenCalled()
    expect(closeSecond).not.toHaveBeenCalled()

    unregisterFirst()
    unregisterSecond()
  })

  it('registers a replacement when previous cleanup fails', async () => {
    const unregisterFirst = await registerManagedEventHubStream('failing', async () => {
      throw new Error('cleanup failed')
    })
    const closeSecond = vi.fn<() => Promise<void>>(async () => {})

    const unregisterSecond = await registerManagedEventHubStream('failing', closeSecond)
    unregisterFirst()
    const unregisterThird = await registerManagedEventHubStream(
      'failing',
      vi.fn<() => Promise<void>>(async () => {}),
    )
    expect(closeSecond).toHaveBeenCalledOnce()

    unregisterSecond()
    unregisterThird()
  })
})
