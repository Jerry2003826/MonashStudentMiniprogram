import type { ReportReason } from '../types/api'

const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  ad: '广告',
  porn: '色情低俗',
  abuse: '人身攻击',
  illegal: '违法违规',
  other: '其他',
}

export const REPORT_REASONS = (Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map(
  (value) => ({
    value,
    label: REPORT_REASON_LABELS[value],
  }),
)
