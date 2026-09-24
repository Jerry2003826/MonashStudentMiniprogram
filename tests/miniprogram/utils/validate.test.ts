import { describe, expect, it } from 'vitest'
import { isStudentEmail, normalizeEmail } from '../../../miniprogram/utils/validate'

describe('isStudentEmail', () => {
  it('接受 @student.monash.edu 邮箱，不区分大小写', () => {
    expect(isStudentEmail('a@student.monash.edu')).toBe(true)
    expect(isStudentEmail('A@Student.Monash.edu')).toBe(true)
  })

  it('忽略首尾空格', () => {
    expect(isStudentEmail('  a@student.monash.edu ')).toBe(true)
  })

  it('拒绝其他邮箱和不合法的输入', () => {
    expect(isStudentEmail('a@monash.edu')).toBe(false)
    expect(isStudentEmail('a@student.monash.edu.au')).toBe(false)
    expect(isStudentEmail('a b@student.monash.edu')).toBe(false)
    expect(isStudentEmail('')).toBe(false)
  })
})

describe('normalizeEmail', () => {
  it('去掉首尾空格并转成小写', () => {
    expect(normalizeEmail('  Jli0001@Student.Monash.EDU ')).toBe('jli0001@student.monash.edu')
  })
})
