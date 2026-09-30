const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/
const DOMAIN_LABEL_PATTERN =
  /^[a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]{0,61}[a-z0-9\u00a1-\uffff])?$/i
const TOP_LEVEL_DOMAIN_PATTERN = /^(?:[a-z\u00a1-\uffff-]{2,63}|xn--[a-z0-9]{1,59})$/i

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizeEmailDomains(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const domains: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const domain = item.trim().toLowerCase()
    const labels = domain.split('.')
    if (
      domain.length > 253 ||
      labels.length < 2 ||
      !labels.every((label) => DOMAIN_LABEL_PATTERN.test(label)) ||
      !TOP_LEVEL_DOMAIN_PATTERN.test(labels[labels.length - 1])
    )
      return null
    if (!domains.includes(domain)) domains.push(domain)
  }
  return domains
}

export function isStudentEmail(email: string, allowedDomains: readonly string[]): boolean {
  const normalized = normalizeEmail(email)
  const domains = normalizeEmailDomains(allowedDomains)
  return (
    normalized.length <= 254 &&
    EMAIL_PATTERN.test(normalized) &&
    domains !== null &&
    domains.includes(normalized.split('@')[1])
  )
}
