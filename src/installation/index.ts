import { Flag } from "../flag/flag"

declare global {
  const REASLAB_VERSION: string
  const REASLAB_CHANNEL: string
}

export namespace Installation {
  export const VERSION = typeof REASLAB_VERSION === "string" ? REASLAB_VERSION : "local"
  export const CHANNEL = typeof REASLAB_CHANNEL === "string" ? REASLAB_CHANNEL : "local"
  export const USER_AGENT = `reaslab-agent/${CHANNEL}/${VERSION}/${Flag.REASLAB_CLIENT}`
}
