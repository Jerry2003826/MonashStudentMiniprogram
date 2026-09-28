import {
  createComment,
  deleteComment,
  deletePost,
  getPost,
  likePost,
  listComments,
  reportContent,
  unlikePost,
} from '../../services/api/forum'
import { defaultMessage, isApiError, showError } from '../../services/errors'
import type { Author, Comment, PostDetail, ReportTargetType } from '../../types/api'
import { formatRelativeTime } from '../../utils/format'
import { ensureMember } from '../../utils/guard'
import { markDirty } from '../../utils/refresh'
import { REPORT_REASONS } from '../../utils/report'

type CommentView = Comment & { timeText: string }

function toView(comment: Comment): CommentView {
  return { ...comment, timeText: formatRelativeTime(comment.created_at) }
}

// 用户在操作菜单里点「取消」时 wx.showActionSheet 会走 fail，这里统一返回 null
async function pickAction(itemList: string[]): Promise<number | null> {
  try {
    const { tapIndex } = await wx.showActionSheet({ itemList })
    return tapIndex
  } catch {
    return null
  }
}

async function confirm(title: string, content: string): Promise<boolean> {
  const res = await wx.showModal({ title, content, confirmColor: '#d54941' })
  return res.confirm
}

Page({
  data: {
    post: null as PostDetail | null,
    postTime: '',
    errorMessage: '',
    comments: [] as CommentView[],
    commentCursor: null as string | null,
    hasMoreComments: true,
    loadingComments: false,
    draft: '',
    replyTo: null as Author | null,
    inputFocus: false,
    sending: false,
  },

  postId: 0,

  async onLoad(query: Record<string, string | undefined>) {
    this.postId = Number(query.id)
    try {
      const post = await getPost(this.postId)
      this.setData({ post, postTime: formatRelativeTime(post.created_at) })
      if (post.moderation_status === 'approved') await this.loadComments()
    } catch (err) {
      this.setData({
        errorMessage: isApiError(err) ? err.message : defaultMessage('INTERNAL_ERROR'),
      })
      showError(err)
    }
  },

  async onPullDownRefresh() {
    this.setData({
      post: null,
      errorMessage: '',
      comments: [],
      commentCursor: null,
      hasMoreComments: true,
    })
    try {
      await this.onLoad({ id: String(this.postId) })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    this.loadComments()
  },

  async loadComments() {
    if (
      this.data.post?.moderation_status !== 'approved' ||
      this.data.loadingComments ||
      !this.data.hasMoreComments
    )
      return
    this.setData({ loadingComments: true })
    try {
      const page = await listComments(this.postId, this.data.commentCursor ?? undefined)
      this.setData({
        comments: [...this.data.comments, ...page.items.map(toView)],
        commentCursor: page.next_cursor,
        hasMoreComments: page.next_cursor !== null,
      })
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ loadingComments: false })
    }
  },

  onPreviewImage(e: WechatMiniprogram.TouchEvent) {
    const urls = (this.data.post?.images ?? []).map((image) => image.url)
    wx.previewImage({ urls, current: urls[Number(e.currentTarget.dataset.index)] })
  },

  async onToggleLike() {
    const post = this.data.post
    if (!post || post.moderation_status !== 'approved') return
    try {
      if (!(await ensureMember('点赞'))) return
      const result = post.liked ? await unlikePost(post.id) : await likePost(post.id)
      this.setData({ 'post.liked': result.liked, 'post.like_count': result.like_count })
      markDirty('forum', 'my-posts')
    } catch (err) {
      showError(err)
    }
  },

  onDraftInput(e: WechatMiniprogram.Input) {
    this.setData({ draft: e.detail.value })
  },

  onInputBlur() {
    this.setData({ inputFocus: false })
  },

  onReplyComment(e: WechatMiniprogram.TouchEvent) {
    const comment = this.data.comments[Number(e.currentTarget.dataset.index)]
    if (!comment || comment.is_mine || comment.moderation_status !== 'approved') return
    this.setData({ replyTo: comment.author, inputFocus: true })
  },

  onCancelReply() {
    this.setData({ replyTo: null })
  },

  async onSendComment() {
    const post = this.data.post
    const content = this.data.draft.trim()
    if (!post || post.moderation_status !== 'approved' || !content || this.data.sending) return
    this.setData({ sending: true })
    try {
      if (!(await ensureMember('评论'))) return
      const comment = await createComment(post.id, {
        content,
        reply_to_user_id: this.data.replyTo?.id,
      })
      this.setData({
        comments: [...this.data.comments, toView(comment)],
        'post.comment_count':
          post.comment_count + (comment.moderation_status === 'approved' ? 1 : 0),
        draft: '',
        replyTo: null,
      })
      markDirty('forum', 'my-posts')
      wx.showToast({
        title: comment.moderation_status === 'pending' ? '评论已提交，等待审核' : '评论已发送',
        icon: 'none',
      })
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ sending: false })
    }
  },

  async onMore() {
    const post = this.data.post
    if (!post) return
    const items: string[] = []
    if (post.moderation_status === 'approved') items.push('举报')
    if (post.is_mine) items.push('删除帖子')
    if (!items.length) return
    const index = await pickAction(items)
    if (index === null) return
    if (items[index] === '举报') await this.report('post', post.id)
    if (items[index] === '删除帖子') await this.removePost()
  },

  async onCommentActions(e: WechatMiniprogram.TouchEvent) {
    const comment = this.data.comments[Number(e.currentTarget.dataset.index)]
    if (!comment) return
    const items = comment.is_mine ? ['删除评论'] : ['回复', '举报']
    const index = await pickAction(items)
    if (index === null) return
    if (comment.is_mine) {
      await this.removeComment(comment)
    } else if (index === 0) {
      this.setData({ replyTo: comment.author, inputFocus: true })
    } else {
      await this.report('comment', comment.id)
    }
  },

  async report(targetType: ReportTargetType, targetId: number) {
    try {
      if (!(await ensureMember('举报'))) return
      const index = await pickAction(REPORT_REASONS.map((reason) => reason.label))
      if (index === null) return
      await reportContent({
        target_type: targetType,
        target_id: targetId,
        reason: REPORT_REASONS[index].value,
      })
      wx.showToast({ title: '已提交，版主会尽快处理', icon: 'none' })
    } catch (err) {
      showError(err)
    }
  },

  async removePost() {
    const post = this.data.post
    if (!post || !(await confirm('删除帖子', '删除后不能恢复，确定要删除吗？'))) return
    try {
      await deletePost(post.id)
      markDirty('forum', 'my-posts')
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      showError(err)
    }
  },

  async removeComment(comment: CommentView) {
    const post = this.data.post
    if (!post || !(await confirm('删除评论', '确定要删除这条评论吗？'))) return
    try {
      await deleteComment(comment.id)
      this.setData({
        comments: this.data.comments.filter((item) => item.id !== comment.id),
        'post.comment_count': Math.max(
          0,
          post.comment_count - (comment.moderation_status === 'approved' ? 1 : 0),
        ),
      })
      markDirty('forum', 'my-posts')
    } catch (err) {
      showError(err)
    }
  },
})
