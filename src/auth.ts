/** Extract a server-declared scope from a WWW-Authenticate challenge. */
export function requiredScopeFromChallenge(challenge: string | undefined): string | undefined {
  if (!challenge) return undefined
  const match = /(?:^|,)\s*scope=(?:"([^"]+)"|([^,\s]+))/i.exec(challenge)
  return match?.[1] ?? match?.[2]
}
