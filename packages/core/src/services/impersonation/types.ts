/**
 * A short-lived, single-purpose impersonation token record.
 */
export interface ImpersonationToken {
  /** Opaque token identifier (also used as the bearer value). */
  tokenId: string
  /** Admin who issued the token. */
  issuedBy: string
  issuedByEmail: string
  /** Target user being impersonated. */
  targetUserId: string
  targetUserEmail: string
  /** Human-readable reason required at issuance for audit trail. */
  reason: string
  /** ISO timestamp of issuance. */
  issuedAt: string
  /** ISO timestamp after which the token is invalid. */
  expiresAt: string
  /** Whether the token has been explicitly revoked before expiry. */
  revoked: boolean
  revokedAt?: string
  revokedBy?: string
}

export interface IssueImpersonationTokenRequest {
  targetUserId: string
  /** Mandatory justification for the support workflow. */
  reason: string
  /** TTL in seconds; defaults to 900 (15 min), max 3600 (1 h). */
  ttlSeconds?: number
}

export interface IssueImpersonationTokenResponse {
  tokenId: string
  targetUserId: string
  targetUserEmail: string
  expiresAt: string
  ttlSeconds: number
}
