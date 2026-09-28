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
