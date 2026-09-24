import { createPost, listBoards, uploadPostImage } from '../../services/api/forum'
import { showError } from '../../services/errors'
import type { Board } from '../../types/api'
import { markDirty } from '../../utils/refresh'

// t-upload 需要的文件结构；不从 tdesign-miniprogram 导入类型，因为 CI 里没有构建好的 miniprogram_npm
interface UploadFileItem {
  url: string
  type: 'image'
  status: 'loading' | 'done' | 'failed'
}

Page({
  data: {
    boards: [] as Board[],
    boardId: 0,
    title: '',
    content: '',
    files: [] as UploadFileItem[],
    submitting: false,
    canSubmit: false,
  },

  // 本地图片路径 → 上传后得到的图片 ID
  imageIds: {} as Record<string, number>,

  async onLoad() {
    try {
      const boards = await listBoards()
      this.setData({ boards: boards.filter((board) => !board.staff_only) })
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

  async onAddImages(e: WechatMiniprogram.CustomEvent<{ files: { url: string }[] }>) {
    const added: UploadFileItem[] = e.detail.files.map((file) => ({
      url: file.url,
      type: 'image',
      status: 'loading',
    }))
    this.setData({ files: [...this.data.files, ...added] })
    this.updateCanSubmit()
    await Promise.all(added.map((file) => this.uploadOne(file.url)))
  },

  async uploadOne(url: string) {
    try {
      const image = await uploadPostImage(url)
      this.imageIds[url] = image.id
      this.setFileStatus(url, 'done')
    } catch (err) {
      this.setFileStatus(url, 'failed')
      showError(err)
    }
    this.updateCanSubmit()
  },

  setFileStatus(url: string, status: UploadFileItem['status']) {
    this.setData({
      files: this.data.files.map((file) => (file.url === url ? { ...file, status } : file)),
    })
  },

  onRemoveImage(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const files = [...this.data.files]
    const [removed] = files.splice(e.detail.index, 1)
    if (removed) delete this.imageIds[removed.url]
    this.setData({ files })
    this.updateCanSubmit()
  },

  updateCanSubmit() {
    const { boardId, title, content, files } = this.data
    this.setData({
      canSubmit:
        boardId > 0 &&
        title.trim() !== '' &&
        content.trim() !== '' &&
        files.every((file) => file.status === 'done'),
    })
  },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const { boardId, title, content, files } = this.data
      await createPost({
        board_id: boardId,
        title: title.trim(),
        content: content.trim(),
        image_ids: files.map((file) => this.imageIds[file.url]),
      })
      markDirty('forum', 'my-posts')
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },
})
