/** Public Free repository stub — Pro validation is not shipped here. */
export interface LicenseStatus {
  valid: boolean
  plan?: 'pro' | 'trial'
  expiresAt?: string
  message?: string
}

export async function validateLicense(
  _key: string,
  _apiUrl?: string
): Promise<LicenseStatus> {
  return { valid: false, message: 'RollDate Events Pro is not available in the Free repository.' }
}
