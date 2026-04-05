/**
 * Provider-specific quirks and compatibility rules
 */

export namespace ProviderQuirks {
  /**
   * Providers that don't support 'developer' role (which AI SDK may convert 'system' to)
   * For these providers, system prompts should be sent as user messages instead
   */
  export function requiresSystemAsUser(providerID: string): boolean {
    const id = providerID.toLowerCase()
    // Most third-party API relays don't support the 'developer' role
    // that AI SDK converts 'system' to. Default to true unless using
    // direct OpenAI or Anthropic APIs.
    if (id.includes("openai.com") || id.includes("anthropic")) return false
    return true
  }
}
