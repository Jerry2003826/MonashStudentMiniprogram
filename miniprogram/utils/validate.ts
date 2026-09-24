const STUDENT_EMAIL_PATTERN = /^[^\s@]+@student\.monash\.edu$/i

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isStudentEmail(email: string): boolean {
  return STUDENT_EMAIL_PATTERN.test(email.trim())
}
