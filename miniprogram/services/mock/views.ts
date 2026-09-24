import type {
  Author,
  Board,
  Comment,
  MerchantDetail,
  MerchantSummary,
  PostDetail,
  PostImage,
  PostSummary,
} from '../../types/api'
import {
  DELETED_NICKNAME,
  type MockComment,
  type MockDb,
  type MockMerchant,
  type MockPost,
} from './db'

const EXCERPT_LENGTH = 60
const THUMBNAIL_COUNT = 3

export function toAuthor(db: MockDb, userId: number): Author {
  const user = db.users.find((item) => item.id === userId)
  if (!user) return { id: userId, nickname: DELETED_NICKNAME, avatar_url: null }
  return { id: user.id, nickname: user.nickname, avatar_url: user.avatar_url }
}

export function toMerchantSummary(db: MockDb, merchant: MockMerchant): MerchantSummary {
  const category = db.categories.find((item) => item.id === merchant.category_id)
  const area = db.areas.find((item) => item.id === merchant.area_id)
  if (!category || !area) throw new Error(`假数据里商家 ${merchant.id} 的分类或区域不存在`)
  return {
    id: merchant.id,
    name: merchant.name,
    logo_url: merchant.logo_url,
    category: { ...category },
    area: { ...area },
    discount_summary: merchant.discount_summary,
  }
}

export function toMerchantDetail(db: MockDb, merchant: MockMerchant): MerchantDetail {
  return {
    ...toMerchantSummary(db, merchant),
    intro: merchant.intro,
    discount_terms: merchant.discount_terms,
    image_urls: [...merchant.image_urls],
    address: merchant.address,
    latitude: merchant.latitude,
    longitude: merchant.longitude,
    phone: merchant.phone,
    opening_hours: merchant.opening_hours,
  }
}

function boardOf(db: MockDb, post: MockPost): Board {
  const board = db.boards.find((item) => item.id === post.board_id)
  if (!board) throw new Error(`假数据里帖子 ${post.id} 的板块不存在`)
  return { ...board }
}

// 审核通过的图片所有人可见；待审核的只有上传者本人能看到
function visibleImages(db: MockDb, post: MockPost): PostImage[] {
  return post.image_ids
    .map((id) => db.images.find((image) => image.id === id))
    .filter((image) => image !== undefined)
    .filter(
      (image) =>
        image.check_status === 'pass' ||
        (image.check_status === 'pending' && image.uploader_id === db.meId),
    )
    .map((image) => ({ id: image.id, url: image.url, check_status: image.check_status }))
}

export function commentCountOf(db: MockDb, postId: number): number {
  return db.comments.filter((comment) => comment.post_id === postId && !comment.deleted).length
}

export function toPostSummary(db: MockDb, post: MockPost): PostSummary {
  return {
    id: post.id,
    board: boardOf(db, post),
    title: post.title,
    excerpt: post.content.replace(/\s+/g, ' ').slice(0, EXCERPT_LENGTH),
    thumbnail_urls: visibleImages(db, post)
      .filter((image) => image.check_status === 'pass')
      .slice(0, THUMBNAIL_COUNT)
      .map((image) => image.url),
    author: toAuthor(db, post.author_id),
    like_count: post.like_count,
    comment_count: commentCountOf(db, post.id),
    is_pinned: post.is_pinned,
    created_at: post.created_at,
  }
}

export function toPostDetail(db: MockDb, post: MockPost): PostDetail {
  return {
    id: post.id,
    board: boardOf(db, post),
    title: post.title,
    content: post.content,
    images: visibleImages(db, post),
    author: toAuthor(db, post.author_id),
    like_count: post.like_count,
    comment_count: commentCountOf(db, post.id),
    liked: db.likedPostIds.includes(post.id),
    is_pinned: post.is_pinned,
    is_mine: post.author_id === db.meId,
    created_at: post.created_at,
  }
}

export function toComment(db: MockDb, comment: MockComment): Comment {
  return {
    id: comment.id,
    author: toAuthor(db, comment.author_id),
    reply_to: comment.reply_to_user_id === null ? null : toAuthor(db, comment.reply_to_user_id),
    content: comment.content,
    created_at: comment.created_at,
    is_mine: comment.author_id === db.meId,
  }
}
