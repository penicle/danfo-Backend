/**
 * Verification proof package types
 */

export interface BondSnapshot {
  address: string
  bondedAmount: string
  bondStart: number | null
  bondDuration: number | null
  active: boolean
}

export interface AttestationSummary {
  count: number
  hash: string
}

export interface VerificationProof {
  address: string
  score: number
  bondSnapshot: BondSnapshot
  attestationSummary: AttestationSummary
  timestamp: number
  expiresAt?: number
  canonical: string
  hash: string
}

export interface SignedVerificationProof extends VerificationProof {
  signature: string
}
