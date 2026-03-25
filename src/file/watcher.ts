// Shim: file watcher not needed in container (no TUI/UI to update)
import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export namespace FileWatcher {
  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  export async function init(): Promise<void> {}
}
