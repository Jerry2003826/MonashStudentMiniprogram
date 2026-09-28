import { createPost, listBoards } from '../../services/api/forum'
import { fetchMe } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Board } from '../../types/api'
import { ensureMember } from '../../utils/guard'
import { markDirty } from '../../utils/refresh'

Page({
  data: {
    boards: [] as Board[],
    boardId: 0,
    title: '',
    content: '',
    submitting: false,
    canSubmit: false,
  },

  async onLoad() {
    try {
      const [boards, me] = await Promise.all([listBoards(), fetchMe()])
      const staff = me.staff_role === 'owner' || me.staff_role === 'editor'
      this.setData({ boards: boards.filter((board) => !board.staff_only || staff) })
    } catch (err) {
      showError(err)
    }
  },

  onBoardTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({ boardId: Number(e.currentTarget.dataset.id) })
    this.updateCanSubmit()
  },

  onTitleChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ title: e.detail.value })
    this.updateCanSubmit()
  },

  onContentChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ content: e.detail.value })
    this.updateCanSubmit()
  },

  updateCanSubmit() {
    const { boardId, title, content } = this.data
    this.setData({
      canSubmit:
        boardId > 0 &&
        title.trim().length > 0 &&
        title.trim().length <= 50 &&
        content.trim().length > 0 &&
        content.trim().length <= 5000,
    })
  },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    this.setData({ submitting: true })
    try {
      if (!(await ensureMember('发帖'))) return
      const { boardId, title, content } = this.data
      const post = await createPost({
        board_id: boardId,
        title: title.trim(),
        content: content.trim(),
        image_ids: [],
      })
      markDirty('forum', 'my-posts')
      wx.showToast({
        title: post.moderation_status === 'pending' ? '已提交，等待审核' : '发布成功',
        icon: 'none',
      })
      wx.redirectTo({ url: `/pages/post-detail/index?id=${post.id}` })
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },
})
