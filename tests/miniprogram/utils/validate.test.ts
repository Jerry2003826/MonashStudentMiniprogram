import { describe, expect, it } from 'vitest'
import { isStudentEmail, normalizeEmail } from '../../../miniprogram/utils/validate'

const domains = ['student.monash.edu']

describe('isStudentEmail', () => {
  it('接受 @student.monash.edu 邮箱，不区分大小写', () => {
    expect(isStudentEmail('a@student.monash.edu', domains)).toBe(true)
    expect(isStudentEmail('A@Student.Monash.edu', domains)).toBe(true)
  })

  it('忽略首尾空格', () => {
    expect(isStudentEmail('  a@student.monash.edu ', domains)).toBe(true)
  })

  it('拒绝其他邮箱和不合法的输入', () => {
    expect(isStudentEmail('a@monash.edu', domains)).toBe(false)
    expect(isStudentEmail('a@student.monash.edu.au', domains)).toBe(false)
    expect(isStudentEmail('a b@student.monash.edu', domains)).toBe(false)
    expect(isStudentEmail('', domains)).toBe(false)
  })
})

describe('normalizeEmail', () => {
  it('去掉首尾空格并转成小写', () => {
    expect(normalizeEmail('  Jli0001@Student.Monash.EDU ')).toBe('jli0001@student.monash.edu')
  })
})
