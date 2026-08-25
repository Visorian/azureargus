import { registerManagedEventHubStream } from "../../server/utils/managedEventHubStreamRegistry";

describe("managed Event Hub stream registry", () => {
  it("serializes replacements and protects the newest owner's entry", async () => {
    let finishFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const closeFirst = vi.fn<() => Promise<void>>(() => firstFinished);
    const closeSecond = vi.fn<() => Promise<void>>(async () => undefined);
    const unregisterFirst = await registerManagedEventHubStream("session", closeFirst);

    let secondRegistered = false;
    const registeringSecond = registerManagedEventHubStream("session", closeSecond).then(
      (unregister) => {
        secondRegistered = true;
        return unregister;
      },
    );
    await vi.waitFor(() => expect(closeFirst).toHaveBeenCalledOnce());
    expect(secondRegistered).toBe(false);

    finishFirst();
    const unregisterSecond = await registeringSecond;
    unregisterFirst();

    const unregisterThird = await registerManagedEventHubStream(
      "session",
      vi.fn<() => Promise<void>>(async () => undefined),
    );
    expect(closeSecond).toHaveBeenCalledOnce();

    unregisterSecond();
    unregisterThird();
  });

  it("keeps different sessions independent", async () => {
    const closeFirst = vi.fn<() => Promise<void>>(async () => undefined);
    const closeSecond = vi.fn<() => Promise<void>>(async () => undefined);

    const unregisterFirst = await registerManagedEventHubStream("first", closeFirst);
    const unregisterSecond = await registerManagedEventHubStream("second", closeSecond);
    expect(closeFirst).not.toHaveBeenCalled();
    expect(closeSecond).not.toHaveBeenCalled();

    unregisterFirst();
    unregisterSecond();
  });
});
