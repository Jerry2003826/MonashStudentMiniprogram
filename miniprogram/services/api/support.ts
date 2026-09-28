import type { FeedbackBody, FeedbackResult, SupportContent } from '../../types/support'
import { request } from '../request'

export function getSupportContent(): Promise<SupportContent> {
  return request<SupportContent>({ method: 'GET', path: '/support', auth: false })
}

const pendingFeedback = new Map<string, Promise<FeedbackResult>>()

export function submitFeedback(body: FeedbackBody): Promise<FeedbackResult> {
  const normalized: FeedbackBody = {
    category: body.category,
    content: body.content.trim(),
    ...(body.contact?.trim() ? { contact: body.contact.trim() } : {}),
  }
  const key = JSON.stringify(normalized)
  const pending = pendingFeedback.get(key)
  if (pending) return pending

  const submission = request<FeedbackResult>({
    method: 'POST',
    path: '/feedback',
    body: normalized,
  }).finally(() => {
    pendingFeedback.delete(key)
  })
  pendingFeedback.set(key, submission)
  return submission
}
