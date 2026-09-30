import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Board, Comment, PostDetail } from '../../../miniprogram/types/api'
import { makeMe } from '../helpers/membership'

const mocks = vi.hoisted(() => ({
  boards: vi.fn(),
  create: vi.fn(),
  post: vi.fn(),
  comments: vi.fn(),
  comment: vi.fn(),
  member: vi.fn(),
  me: vi.fn(),
  error: vi.fn(),
  like: vi.fn(),
  removeComment: vi.fn(),
}))
vi.mock('../../../miniprogram/services/api/forum', () => ({
  listBoards: mocks.boards,
  createPost: mocks.create,
  getPost: mocks.post,
  listComments: mocks.comments,
  createComment: mocks.comment,
  likePost: mocks.like,
  unlikePost: vi.fn(),
  deletePost: vi.fn(),
  deleteComment: mocks.removeComment,
  reportContent: vi.fn(),
}))
vi.mock('../../../miniprogram/services/auth', () => ({ fetchMe: mocks.me }))
vi.mock('../../../miniprogram/services/errors', () => ({
  showError: mocks.error,
  isApiError: () => false,
  defaultMessage: () => '服务不可用',
}))
vi.mock('../../../miniprogram/utils/guard', () => ({ ensureMember: mocks.member }))
vi.mock('../../../miniprogram/utils/refresh', () => ({ markDirty: vi.fn() }))

const board: Board = { id: 1, name: '校园交流', intro: '', staff_only: false }
function post(status: PostDetail['moderation_status'] = 'approved'): PostDetail {
  return {
    id: 9,
    board,
    title: '校园交流',
    content: '一起学习',
    images: [],
    author: { id: 1, nickname: '同学', avatar_url: null },
    like_count: 0,
    comment_count: 3,
    liked: false,
    is_pinned: false,
    is_mine: true,
    created_at: '2026-09-28T00:00:00Z',
    moderation_status: status,
    review_note: '',
  }
}
interface Editor {
  data: {
    boards: Board[]
    title: string
    content: string
    boardId: number
    canSubmit: boolean
    submitting: boolean
  }
  setData(patch: Record<string, unknown>): void
  onLoad(): Promise<void>
  onSubmit(): Promise<void>
  updateCanSubmit(): void
}
interface Detail {
  data: { post: PostDetail | null; draft: string; comments: Comment[]; sending: boolean }
  setData(patch: Record<string, unknown>): void
  onLoad(query: { id: string }): Promise<void>
  loadComments(): Promise<void>
  onSendComment(): Promise<void>
  onToggleLike(): Promise<void>
  removeComment(comment: Comment & { timeText: string }): Promise<void>
}
async function page<T>(path: 'editor' | 'detail'): Promise<T> {
  let result: unknown
  vi.stubGlobal(
    'Page',
    (definition: {
      data: Record<string, unknown>
      setData: (patch: Record<string, unknown>) => void
    }) => {
      definition.setData = (patch) => {
        for (const [key, value] of Object.entries(patch)) {
          const [head, field] = key.split('.')
          if (field) (definition.data[head] as Record<string, unknown>)[field] = value
          else definition.data[key] = value
        }
      }
      result = definition
    },
  )
  if (path === 'editor') await import('../../../miniprogram/pages/post-create/index')
  else await import('../../../miniprogram/pages/post-detail/index')
  return result as T
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.member.mockResolvedValue(true)
  mocks.me.mockResolvedValue(makeMe())
  mocks.boards.mockResolvedValue([board, { ...board, id: 6, staff_only: true }])
  mocks.post.mockResolvedValue(post())
  mocks.comments.mockResolvedValue({ items: [], next_cursor: null })
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    redirectTo: vi.fn(),
    showModal: vi.fn().mockResolvedValue({ confirm: true }),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('论坛人工审核页面', () => {
  it('普通用户隐藏官方板块，编辑员可选择；后端仍执行会员校验', async () => {
    const editor = await page<Editor>('editor')
    await editor.onLoad()
    expect(editor.data.boards.map((item) => item.id)).toEqual([1])
    mocks.me.mockResolvedValue(makeMe({}, 'editor'))
    await editor.onLoad()
    expect(editor.data.boards.map((item) => item.id)).toEqual([1, 6])
  })

  it('文字提交进入待审详情，重复点击不创建第二条，也不宣称发布成功', async () => {
    const editor = await page<Editor>('editor')
    Object.assign(editor.data, { boardId: 1, title: ' 校园交流 ', content: ' 一起学习 ' })
    editor.updateCanSubmit()
    let resolve!: (value: PostDetail) => void
    mocks.create.mockImplementation(
      () =>
        new Promise<PostDetail>((done) => {
          resolve = done
        }),
    )
    const first = editor.onSubmit()
    await Promise.resolve()
    await editor.onSubmit()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    resolve(post('pending'))
    await first
    expect(mocks.create).toHaveBeenCalledWith({
      board_id: 1,
      title: '校园交流',
      content: '一起学习',
      image_ids: [],
    })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已提交，等待审核', icon: 'none' })
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/post-detail/index?id=9' })
  })

  it('提交失败保留草稿，会员校验失败不发请求', async () => {
    const editor = await page<Editor>('editor')
    Object.assign(editor.data, { boardId: 1, title: '校园交流', content: '一起学习' })
    editor.updateCanSubmit()
    mocks.create.mockRejectedValue(new Error('网络错误'))
    await editor.onSubmit()
    expect(editor.data).toMatchObject({ title: '校园交流', content: '一起学习', submitting: false })
    mocks.create.mockClear()
    mocks.member.mockResolvedValue(false)
    await editor.onSubmit()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('待审详情不加载评论，不允许发评论或点赞', async () => {
    mocks.post.mockResolvedValue(post('pending'))
    const detail = await page<Detail>('detail')
    await detail.onLoad({ id: '9' })
    detail.data.draft = '新的评论'
    await detail.onSendComment()
    await detail.onToggleLike()
    expect(detail.data.post?.moderation_status).toBe('pending')
    expect(mocks.comments).not.toHaveBeenCalled()
    expect(mocks.comment).not.toHaveBeenCalled()
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('新评论待审核，不增加公开计数；删除它也不减少公开计数', async () => {
    const detail = await page<Detail>('detail')
    await detail.onLoad({ id: '9' })
    const comment: Comment = {
      id: 5,
      author: post().author,
      reply_to: null,
      content: '新的评论',
      created_at: post().created_at,
      is_mine: true,
      moderation_status: 'pending',
      review_note: '',
    }
    mocks.comment.mockResolvedValue(comment)
    detail.data.draft = '新的评论'
    await detail.onSendComment()
    expect(detail.data.comments).toHaveLength(1)
    expect(detail.data.post?.comment_count).toBe(3)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '评论已提交，等待审核', icon: 'none' })
    await detail.removeComment({ ...comment, timeText: '' })
    expect(detail.data.post?.comment_count).toBe(3)
    expect(detail.data.comments).toHaveLength(0)
  })
})

describe('评论分页去重', () => {
  function comment(id: number, status: Comment['moderation_status'] = 'approved'): Comment {
    return {
      id,
      author: post().author,
      reply_to: null,
      content: `评论 ${id}`,
      created_at: new Date(Date.UTC(2026, 8, 28, 0, 0, id)).toISOString(),
      is_mine: true,
      moderation_status: status,
      review_note: '',
    }
  }

  it('25条评论后新提交的第26条不会在第二页重复，并保留服务器最新审核状态及顺序', async () => {
    mocks.comments.mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, i) => comment(i + 1)),
      next_cursor: '20',
    })
    const detail = await page<Detail>('detail')
    await detail.onLoad({ id: '9' })
    mocks.comment.mockResolvedValueOnce(comment(26, 'pending'))
    detail.data.draft = '新的评论'
    await detail.onSendComment()
    expect(detail.data.comments).toHaveLength(21)
    mocks.comments.mockResolvedValueOnce({
      items: Array.from({ length: 6 }, (_, i) => comment(i + 21)),
      next_cursor: null,
    })
    await detail.loadComments()
    expect(mocks.comments).toHaveBeenLastCalledWith(9, '20')
    expect(detail.data.comments.map((item) => item.id)).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1),
    )
    expect(detail.data.comments[25].moderation_status).toBe('approved')
    await detail.loadComments()
    expect(mocks.comments).toHaveBeenCalledTimes(2)
  })

  it('分页先于提交响应返回同一条评论时保留最新审核状态且不重复', async () => {
    mocks.comments.mockResolvedValueOnce({ items: [comment(1)], next_cursor: '20' })
    const detail = await page<Detail>('detail')
    await detail.onLoad({ id: '9' })
    let resolve!: (value: Comment) => void
    mocks.comment.mockImplementationOnce(
      () =>
        new Promise<Comment>((done) => {
          resolve = done
        }),
    )
    detail.data.draft = '新的评论'
    const sending = detail.onSendComment()
    await Promise.resolve()
    mocks.comments.mockResolvedValueOnce({ items: [comment(2, 'approved')], next_cursor: null })
    await detail.loadComments()
    resolve(comment(2, 'pending'))
    await sending
    expect(detail.data.comments.map((item) => item.id)).toEqual([1, 2])
    expect(detail.data.comments[1].moderation_status).toBe('approved')
  })

  it('重叠页面按ID合并，相同时间用ID稳定排序，失败重试不丢已有评论', async () => {
    const sameTime = comment(1).created_at
    mocks.comments.mockResolvedValueOnce({ items: [comment(1)], next_cursor: '20' })
    const detail = await page<Detail>('detail')
    await detail.onLoad({ id: '9' })
    mocks.comments.mockRejectedValueOnce(new Error('offline'))
    await detail.loadComments()
    expect(detail.data.comments.map((item) => item.id)).toEqual([1])
    mocks.comments.mockResolvedValueOnce({
      items: [
        { ...comment(3), created_at: sameTime },
        comment(1),
        { ...comment(2), created_at: sameTime },
      ],
      next_cursor: null,
    })
    await detail.loadComments()
    expect(detail.data.comments.map((item) => item.id)).toEqual([1, 2, 3])
  })
})
