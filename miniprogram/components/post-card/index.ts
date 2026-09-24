import type { PostSummary } from '../../types/api'
import { formatRelativeTime } from '../../utils/format'

Component({
  properties: {
    post: { type: Object, value: {} },
  },
  data: {
    timeText: '',
  },
  observers: {
    post(post: PostSummary) {
      this.setData({ timeText: post.created_at ? formatRelativeTime(post.created_at) : '' })
    },
  },
  methods: {
    onTap() {
      const post = this.data.post as PostSummary
      wx.navigateTo({ url: `/pages/post-detail/index?id=${post.id}` })
    },
  },
})
