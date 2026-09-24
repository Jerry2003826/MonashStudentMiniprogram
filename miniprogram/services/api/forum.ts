import type {
  Board,
  Comment,
  CreateCommentBody,
  CreatePostBody,
  CreateReportBody,
  LikeResult,
  Paginated,
  PostDetail,
  PostImage,
  PostQuery,
  PostSummary,
} from '../../types/api'
import { request, uploadFile } from '../request'

export function listBoards(): Promise<Board[]> {
  return request<Board[]>({ method: 'GET', path: '/forum/boards' })
}

export function listPosts(query: PostQuery): Promise<Paginated<PostSummary>> {
  return request<Paginated<PostSummary>>({
    method: 'GET',
    path: '/forum/posts',
    query: { board: query.board, q: query.q, author: query.author, cursor: query.cursor },
  })
}

export function getPost(id: number): Promise<PostDetail> {
  return request<PostDetail>({ method: 'GET', path: `/forum/posts/${id}` })
}

export function createPost(body: CreatePostBody): Promise<PostDetail> {
  return request<PostDetail>({ method: 'POST', path: '/forum/posts', body })
}

export async function deletePost(id: number): Promise<void> {
  await request<null>({ method: 'DELETE', path: `/forum/posts/${id}` })
}

export function listComments(postId: number, cursor?: string): Promise<Paginated<Comment>> {
  return request<Paginated<Comment>>({
    method: 'GET',
    path: `/forum/posts/${postId}/comments`,
    query: { cursor },
  })
}

export function createComment(postId: number, body: CreateCommentBody): Promise<Comment> {
  return request<Comment>({ method: 'POST', path: `/forum/posts/${postId}/comments`, body })
}

export async function deleteComment(id: number): Promise<void> {
  await request<null>({ method: 'DELETE', path: `/forum/comments/${id}` })
}

export function likePost(id: number): Promise<LikeResult> {
  return request<LikeResult>({ method: 'PUT', path: `/forum/posts/${id}/like` })
}

export function unlikePost(id: number): Promise<LikeResult> {
  return request<LikeResult>({ method: 'DELETE', path: `/forum/posts/${id}/like` })
}

export function uploadPostImage(filePath: string): Promise<PostImage> {
  return uploadFile<PostImage>('/forum/images', filePath)
}

export async function reportContent(body: CreateReportBody): Promise<void> {
  await request<null>({ method: 'POST', path: '/forum/reports', body })
}
