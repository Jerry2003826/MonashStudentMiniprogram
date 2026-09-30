import { describe, expect, it } from 'vitest'
import { isStudentEmail, normalizeEmailDomains } from '../../../miniprogram/utils/validate'

describe('server-provided membership email domains', () => {
  it('normalizes and deduplicates multiple domains without restoring the default', () => {
    const domains = normalizeEmailDomains([
      ' Students.Example.edu ',
      'ALUMNI.EXAMPLE.ORG',
      'students.example.edu',
    ])!
    expect(domains).toEqual(['students.example.edu', 'alumni.example.org'])
    expect(isStudentEmail(' Student@Students.Example.edu ', domains)).toBe(true)
    expect(isStudentEmail('person@alumni.example.org', domains)).toBe(true)
    expect(isStudentEmail('student@student.monash.edu', domains)).toBe(false)
  })

  it.each([
    '',
    '@students.example.edu',
    'a b@students.example.edu',
    'a@@students.example.edu',
    'a@sub.students.example.edu',
    'a@students.example.edu.evil.test',
    'a@other.example.edu',
    `${'a'.repeat(254)}@students.example.edu`,
  ])('rejects malformed or unlisted email %s', (email) => {
    expect(isStudentEmail(email, ['students.example.edu'])).toBe(false)
  })

  it.each([
    null,
    undefined,
    [],
    'students.example.edu',
    [''],
    [null],
    ['students.example.edu', null],
    ['students.example.edu', ''],
    ['https://students.example.edu'],
    ['*.students.example.edu'],
    ['student@example.edu'],
    ['students..example.edu'],
    ['-students.example.edu'],
    ['students-.example.edu'],
    ['localhost'],
    [`${'a'.repeat(64)}.example.edu`],
  ])('rejects unusable allowlist %#', (value) => {
    expect(normalizeEmailDomains(value)).toBeNull()
  })

  it('fails closed when validation has no allowlist or any invalid domain', () => {
    expect(isStudentEmail('a@student.monash.edu', [])).toBe(false)
    expect(isStudentEmail('a@student.monash.edu', ['student.monash.edu', '*'])).toBe(false)
  })
})
