import { deleteAccount, updateNickname, uploadAvatar } from '../../services/api/me'
import { fetchMe, logout } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Me } from '../../types/api'
import { profileMemberStatus } from '../../utils/membership'
import { syncTabBar } from '../../utils/tab-bar'

Page({
  data: {
    me: null as Me | null,
    nickname: '',
    avatarUrl: '',
    status: profileMemberStatus(null),
    mockFeatures: false,
    testingLabel: '',
  },

  onShow() {
    syncTabBar(this, 'profile')
    this.setData({ mockFeatures: isMockEnabled(), testingLabel: getTestingLabel() })
    this.load()
  },

  async load() {
    try {
      this.applyMe(await fetchMe())
    } catch (err) {
      showError(err)
    }
  },

  applyMe(me: Me) {
    this.setData({
      me,
      nickname: me.nickname,
      avatarUrl: me.avatar_url ?? '',
      status: profileMemberStatus(me),
    })
  },

  async onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    if (!isMockEnabled()) {
      wx.showToast({ title: '头像修改暂未开放', icon: 'none' })
      return
    }
    try {
      this.applyMe(await uploadAvatar(e.detail.avatarUrl))
    } catch (err) {
      showError(err)
    }
  },

  async onNicknameBlur(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const current = this.data.me?.nickname ?? ''
    const nickname = e.detail.value.trim()
    if (!nickname || nickname === current) {
      this.setData({ nickname: current })
      return
    }
    try {
      this.applyMe(await updateNickname(nickname))
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } catch (err) {
      showError(err)
      this.setData({ nickname: current })
    }
  },

  onStatusTap() {
    wx.navigateTo({ url: this.data.status.url })
  },

  onStaffLogin() {
    if (this.data.me?.staff_role) wx.navigateTo({ url: '/pages/staff-login/index' })
  },

  onCopyUserId() {
    if (this.data.me) wx.setClipboardData({ data: String(this.data.me.id), fail: showError })
  },

  onMyPosts() {
    wx.navigateTo({ url: '/pages/my-posts/index' })
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/index' })
  },

  onHandbook() {
    wx.navigateTo({ url: '/pages/handbook/index' })
  },

  onContact() {
    wx.navigateTo({ url: '/pages/contact/index' })
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' })
  },

  onAgreement(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/agreement/index?type=${e.currentTarget.dataset.type}` })
  },

  onDeleteAccount() {
    if (!isMockEnabled()) {
      wx.showModal({
        title: '账号与数据请求',
        content: '自助注销暂未开放。你可以通过意见反馈提交账号或数据处理请求，由运营方跟进。',
        confirmText: '去反馈',
        success: (result) => {
          if (result.confirm) this.onFeedback()
        },
      })
      return
    }
    wx.showModal({
      title: '注销账号',
      content:
        '注销后会删除你的头像、昵称、学生邮箱和会员资格。已发的帖子和评论会保留，作者显示为「已注销用户」。确定要注销吗？',
      confirmText: '注销',
      confirmColor: '#d54941',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteAccount()
          logout()
          wx.reLaunch({ url: '/pages/home/index' })
        } catch (err) {
          showError(err)
        }
      },
    })
  },
})
import { isMockEnabled } from '../../config'
import { getTestingLabel } from '../../deployment'
