import type { Area, Banner, Board, Category } from '../../types/api'
import type { MockComment, MockImage, MockMerchant, MockPost, MockUser } from './db'

// 所有商家、用户和帖子都是虚构的示例数据

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function photo(seed: string, width: number, height: number): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`
}

export interface Seed {
  users: MockUser[]
  banners: Banner[]
  categories: Category[]
  areas: Area[]
  merchants: MockMerchant[]
  boards: Board[]
  images: MockImage[]
  posts: MockPost[]
  comments: MockComment[]
}

const users: MockUser[] = [
  {
    id: 2,
    nickname: '学生会官方',
    avatar_url: photo('avatar-official', 120, 120),
    banned_until: null,
    is_staff: true,
  },
  {
    id: 3,
    nickname: 'Clayton 搬砖人',
    avatar_url: photo('avatar-3', 120, 120),
    banned_until: null,
    is_staff: false,
  },
  {
    id: 4,
    nickname: '奶茶续命中',
    avatar_url: photo('avatar-4', 120, 120),
    banned_until: null,
    is_staff: false,
  },
  { id: 5, nickname: '期末求放过', avatar_url: null, banned_until: null, is_staff: false },
  {
    id: 6,
    nickname: '租房小能手',
    avatar_url: photo('avatar-6', 120, 120),
    banned_until: null,
    is_staff: false,
  },
  {
    id: 7,
    nickname: '一只考拉',
    avatar_url: photo('avatar-7', 120, 120),
    banned_until: null,
    is_staff: false,
  },
]

const categories: Category[] = [
  { id: 1, name: '餐饮' },
  { id: 2, name: '奶茶甜品' },
  { id: 3, name: '购物' },
  { id: 4, name: '生活服务' },
]

const areas: Area[] = [
  { id: 1, name: 'Clayton' },
  { id: 2, name: 'Caulfield' },
  { id: 3, name: 'City' },
]

const CLAYTON = { latitude: -37.9105, longitude: 145.134 }
const CAULFIELD = { latitude: -37.877, longitude: 145.0443 }
const CITY = { latitude: -37.8136, longitude: 144.9631 }

const merchants: MockMerchant[] = [
  {
    id: 1,
    name: '蜀香小馆',
    category_id: 1,
    area_id: 1,
    discount_summary: '会员全单 9 折',
    discount_terms: '堂食可用，酒水除外，不与其他优惠同享。',
    intro: '正宗川菜，水煮鱼和毛血旺是招牌，离 Clayton 校区步行 10 分钟。',
    address: 'Clayton Rd, Clayton VIC 3168',
    ...CLAYTON,
    phone: '03 9000 0001',
    opening_hours: '周一至周日 11:30–21:30',
    is_featured: true,
    is_active: true,
  },
  {
    id: 2,
    name: '茶语时光',
    category_id: 2,
    area_id: 1,
    discount_summary: '会员第二杯半价',
    discount_terms: '每人每天限用一次，特调饮品除外。',
    intro: '现煮奶茶和水果茶，招牌是芝士葡萄。',
    address: 'Centre Rd, Clayton VIC 3168',
    latitude: CLAYTON.latitude + 0.004,
    longitude: CLAYTON.longitude - 0.006,
    phone: '03 9000 0002',
    opening_hours: '周一至周日 10:00–22:00',
    is_featured: true,
    is_active: true,
  },
  {
    id: 3,
    name: '东方超市',
    category_id: 3,
    area_id: 1,
    discount_summary: '会员满 50 澳元减 5 澳元',
    discount_terms: '烟酒和特价商品除外。',
    intro: '中日韩食品和日用品一站购齐，每周二到新鲜蔬菜。',
    address: 'Clayton Rd, Clayton VIC 3168',
    latitude: CLAYTON.latitude - 0.003,
    longitude: CLAYTON.longitude - 0.004,
    phone: '03 9000 0003',
    opening_hours: '周一至周日 9:00–20:00',
    is_featured: false,
    is_active: true,
  },
  {
    id: 4,
    name: '老北京炸酱面',
    category_id: 1,
    area_id: 2,
    discount_summary: '会员赠送小菜一份',
    discount_terms: '每桌限赠一份。',
    intro: '手擀面每天现做，炸酱是老板家传的配方。',
    address: 'Derby Rd, Caulfield East VIC 3145',
    ...CAULFIELD,
    phone: '03 9000 0004',
    opening_hours: '周二至周日 11:00–21:00（周一休息）',
    is_featured: true,
    is_active: true,
  },
  {
    id: 5,
    name: '学霸文具',
    category_id: 3,
    area_id: 2,
    discount_summary: '会员全场 9 折',
    discount_terms: '电子产品除外。',
    intro: '文具、打印和装订，考试季营业到晚上 10 点。',
    address: 'Dandenong Rd, Caulfield East VIC 3145',
    latitude: CAULFIELD.latitude + 0.002,
    longitude: CAULFIELD.longitude + 0.003,
    phone: '03 9000 0005',
    opening_hours: '周一至周六 9:00–19:00',
    is_featured: false,
    is_active: true,
  },
  {
    id: 6,
    name: '喵星人甜品',
    category_id: 2,
    area_id: 3,
    discount_summary: '会员全场 95 折',
    discount_terms: '节假日也可以使用。',
    intro: '手工蛋糕和港式糖水，店里有两只猫。',
    address: 'Swanston St, Melbourne VIC 3000',
    ...CITY,
    phone: '03 9000 0006',
    opening_hours: '周一至周日 12:00–23:00',
    is_featured: false,
    is_active: true,
  },
  {
    id: 7,
    name: '快剪理发',
    category_id: 4,
    area_id: 3,
    discount_summary: '会员剪发 20 澳元',
    discount_terms: '染烫不参与活动，建议提前预约。',
    intro: '中文沟通，男女剪发都做。',
    address: 'Elizabeth St, Melbourne VIC 3000',
    latitude: CITY.latitude + 0.002,
    longitude: CITY.longitude - 0.002,
    phone: '03 9000 0007',
    opening_hours: '周一至周日 10:00–19:00',
    is_featured: false,
    is_active: true,
  },
  {
    id: 8,
    name: 'Kiwi 手机维修',
    category_id: 4,
    area_id: 3,
    discount_summary: '会员维修费 85 折',
    discount_terms: '配件费用不打折。',
    intro: '换屏、换电池最快 30 分钟取机。',
    address: 'Bourke St, Melbourne VIC 3000',
    latitude: CITY.latitude - 0.001,
    longitude: CITY.longitude + 0.003,
    phone: '03 9000 0008',
    opening_hours: '周一至周日 10:00–20:00',
    is_featured: false,
    is_active: true,
  },
].map((merchant) => ({
  ...merchant,
  logo_url: photo(`merchant-logo-${merchant.id}`, 200, 200),
  image_urls: [1, 2, 3].map((n) => photo(`merchant-${merchant.id}-${n}`, 750, 500)),
}))

const boards: Board[] = [
  { id: 1, name: '二手闲置', intro: '闲置物品转让和求购', staff_only: false },
  { id: 2, name: '租房合租', intro: '找房、转租、找室友', staff_only: false },
  { id: 3, name: '学习交流', intro: '选课、作业和考试经验', staff_only: false },
  { id: 4, name: '吃喝玩乐', intro: '美食探店和周末去哪儿', staff_only: false },
  { id: 5, name: '求助问答', intro: '生活中遇到的各种问题', staff_only: false },
  { id: 6, name: '官方公告', intro: '学生会发布的通知和活动', staff_only: true },
]

interface PostSeed {
  id: number
  board_id: number
  author_id: number
  title: string
  content: string
  image_count: number
  like_count: number
  is_pinned: boolean
  ago_ms: number
}

const postSeeds: PostSeed[] = [
  {
    id: 1,
    board_id: 6,
    author_id: 2,
    title: '学生会小程序内测说明',
    content:
      '欢迎体验蒙纳士中国学生会小程序！\n\n现在还在内测阶段，页面上的商家和帖子都是示例数据。\n\n你可以试试：\n1. 在「我的」里完成学生认证（示例验证码是 123456）\n2. 出示电子会员卡\n3. 在论坛发帖、评论和点赞\n\n有任何建议，欢迎在帖子下面留言。',
    image_count: 0,
    like_count: 56,
    is_pinned: true,
    ago_ms: 2 * DAY_MS,
  },
  {
    id: 2,
    board_id: 1,
    author_id: 4,
    title: '出一个九成新的电饭煲',
    content: '搬家出一个小熊电饭煲，用了半年，功能完好。\nClayton 校区附近自取，30 澳元，可小刀。',
    image_count: 2,
    like_count: 3,
    is_pinned: false,
    ago_ms: 35 * MINUTE_MS,
  },
  {
    id: 3,
    board_id: 2,
    author_id: 6,
    title: 'Clayton 两室一厅找室友',
    content:
      'Clayton 站步行 8 分钟，两室一厅，现在空出一间主卧，周租 260 澳元，包水电网。\n希望找作息规律、爱干净的同学，男女不限。',
    image_count: 3,
    like_count: 12,
    is_pinned: false,
    ago_ms: 3 * HOUR_MS,
  },
  {
    id: 4,
    board_id: 3,
    author_id: 5,
    title: 'FIT1045 期末怎么复习？',
    content: '第一次上编程课，感觉期末好难……有没有学长学姐分享一下复习方法？往年的练习题有用吗？',
    image_count: 0,
    like_count: 8,
    is_pinned: false,
    ago_ms: 5 * HOUR_MS,
  },
  {
    id: 5,
    board_id: 4,
    author_id: 7,
    title: '周末去 Brighton 看彩色小屋',
    content:
      '周六天气特别好，坐 Sandringham 线到 Brighton Beach 站，走十几分钟就到了。\n拍照建议下午去，光线最好！',
    image_count: 4,
    like_count: 41,
    is_pinned: false,
    ago_ms: 26 * HOUR_MS,
  },
  {
    id: 6,
    board_id: 5,
    author_id: 3,
    title: 'Myki 卡丢了怎么补办？',
    content: '昨天在电车上把 Myki 卡弄丢了，里面还有 20 多澳元，请问可以补办并把余额转过来吗？',
    image_count: 0,
    like_count: 5,
    is_pinned: false,
    ago_ms: 30 * HOUR_MS,
  },
  {
    id: 7,
    board_id: 1,
    author_id: 7,
    title: '转让宜家书桌',
    content: '宜家白色书桌，120×60 cm，没有划痕，20 澳元，Caulfield 自取。',
    image_count: 1,
    like_count: 2,
    is_pinned: false,
    ago_ms: 2 * DAY_MS + 3 * HOUR_MS,
  },
  {
    id: 8,
    board_id: 3,
    author_id: 4,
    title: '有没有一起去图书馆自习的',
    content: '最近在 Matheson 图书馆复习，想找几个同学一起自习、互相监督，每天下午 2 点到 6 点。',
    image_count: 0,
    like_count: 6,
    is_pinned: false,
    ago_ms: 3 * DAY_MS,
  },
  {
    id: 9,
    board_id: 4,
    author_id: 5,
    title: 'City 新开的火锅店好吃吗',
    content: '路过 Swanston St 看到新开了一家火锅店，排队的人好多，有没有同学去吃过？',
    image_count: 1,
    like_count: 17,
    is_pinned: false,
    ago_ms: 4 * DAY_MS,
  },
  {
    id: 10,
    board_id: 2,
    author_id: 3,
    title: '12 月短租转租',
    content: '12 月回国一个月，房间可以短租，Caulfield 附近，家具齐全，价格可谈。',
    image_count: 0,
    like_count: 1,
    is_pinned: false,
    ago_ms: 6 * DAY_MS,
  },
  {
    id: 11,
    board_id: 5,
    author_id: 6,
    title: '第一次看 GP，OSHC 怎么报销？',
    content: '第一次在澳洲看 GP，想问一下 OSHC 报销的流程是怎样的？需要自己先垫付吗？',
    image_count: 0,
    like_count: 9,
    is_pinned: false,
    ago_ms: 8 * DAY_MS,
  },
  {
    id: 12,
    board_id: 6,
    author_id: 2,
    title: '合作商家招募',
    content:
      '学生会正在招募合作商家，为会员提供专属折扣。\n如果你知道适合合作的商家，欢迎在评论区推荐。',
    image_count: 0,
    like_count: 23,
    is_pinned: false,
    ago_ms: 10 * DAY_MS,
  },
]

interface CommentSeed {
  post_id: number
  author_id: number
  reply_to_user_id: number | null
  content: string
  ago_ms: number
}

const commentSeeds: CommentSeed[] = [
  {
    post_id: 1,
    author_id: 4,
    reply_to_user_id: null,
    content: '已经认证了，会员卡好看！',
    ago_ms: 40 * HOUR_MS,
  },
  {
    post_id: 1,
    author_id: 5,
    reply_to_user_id: null,
    content: '期待论坛正式上线',
    ago_ms: 30 * HOUR_MS,
  },
  {
    post_id: 2,
    author_id: 7,
    reply_to_user_id: null,
    content: '还在吗？明天下午可以去拿吗',
    ago_ms: 20 * MINUTE_MS,
  },
  {
    post_id: 2,
    author_id: 4,
    reply_to_user_id: 7,
    content: '在的，明天下午 3 点 Matheson 图书馆门口见',
    ago_ms: 10 * MINUTE_MS,
  },
  {
    post_id: 3,
    author_id: 5,
    reply_to_user_id: null,
    content: '请问离 Monash 的巴士站远吗？',
    ago_ms: 2 * HOUR_MS,
  },
  {
    post_id: 3,
    author_id: 6,
    reply_to_user_id: 5,
    content: '走路 5 分钟就到 601 路车站',
    ago_ms: 90 * MINUTE_MS,
  },
  {
    post_id: 4,
    author_id: 3,
    reply_to_user_id: null,
    content: '往年题一定要做，考点很接近',
    ago_ms: 4 * HOUR_MS,
  },
  {
    post_id: 4,
    author_id: 7,
    reply_to_user_id: null,
    content: '推荐多看 Ed 上的讨论帖',
    ago_ms: 3 * HOUR_MS,
  },
  {
    post_id: 5,
    author_id: 4,
    reply_to_user_id: null,
    content: '照片好好看！',
    ago_ms: 20 * HOUR_MS,
  },
  {
    post_id: 6,
    author_id: 6,
    reply_to_user_id: null,
    content: '官网可以挂失，注册过的卡余额能转到新卡上',
    ago_ms: 28 * HOUR_MS,
  },
  {
    post_id: 9,
    author_id: 3,
    reply_to_user_id: null,
    content: '去过，味道不错，就是要排一个小时',
    ago_ms: 3 * DAY_MS,
  },
]

export function createSeed(now: number): Seed {
  const iso = (agoMs: number) => new Date(now - agoMs).toISOString()
  const images: MockImage[] = []
  const posts: MockPost[] = postSeeds.map(({ image_count, ago_ms, ...post }) => {
    const imageIds = Array.from({ length: image_count }, (_, index) => {
      const id = post.id * 10 + index + 1
      images.push({
        id,
        url: photo(`post-${post.id}-${index + 1}`, 600, 600),
        uploader_id: post.author_id,
        check_status: 'pass',
      })
      return id
    })
    return { ...post, image_ids: imageIds, created_at: iso(ago_ms), deleted: false }
  })
  const comments: MockComment[] = commentSeeds.map(({ ago_ms, ...comment }, index) => ({
    ...comment,
    id: index + 1,
    created_at: iso(ago_ms),
    deleted: false,
  }))

  const banners: Banner[] = [
    {
      id: 1,
      title: '小程序内测开始啦',
      image_url: photo('banner-1', 750, 320),
      link_type: 'post',
      link_id: 1,
    },
    {
      id: 2,
      title: '合作商家会员折扣上新',
      image_url: photo('banner-2', 750, 320),
      link_type: 'merchant',
      link_id: 2,
    },
    {
      id: 3,
      title: '欢迎加入蒙纳士中国学生会',
      image_url: photo('banner-3', 750, 320),
      link_type: 'none',
      link_id: null,
    },
  ]

  return {
    users: users.map((user) => ({ ...user })),
    banners,
    categories: categories.map((item) => ({ ...item })),
    areas: areas.map((item) => ({ ...item })),
    merchants: merchants.map((item) => ({ ...item, image_urls: [...item.image_urls] })),
    boards: boards.map((item) => ({ ...item })),
    images,
    posts,
    comments,
  }
}
