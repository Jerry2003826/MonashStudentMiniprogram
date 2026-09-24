// 示例文字，正式内容需要学生会审定

export type AgreementType = 'terms' | 'privacy'

export interface AgreementSection {
  heading: string
  body: string
}

export interface Agreement {
  title: string
  sections: AgreementSection[]
}

export const AGREEMENTS: Record<AgreementType, Agreement> = {
  terms: {
    title: '用户协议',
    sections: [
      {
        heading: '一、服务说明',
        body: '本小程序由蒙纳士中国学生会运营，为 Monash University 的同学提供学生认证、电子会员卡、合作商家信息和论坛交流服务。',
      },
      {
        heading: '二、会员',
        body: '会员资格仅限 Monash University 在读学生，通过学生邮箱认证后免费获得，有效期 12 个月。会员卡仅限本人使用，不得转借他人。',
      },
      {
        heading: '三、论坛规则',
        body: '发布内容须遵守法律法规和学校规定，禁止发布广告、色情低俗、人身攻击、违法违规等内容。违规内容会被隐藏或删除，情节严重的账号会被禁言。',
      },
      {
        heading: '四、商家优惠',
        body: '合作商家的优惠由商家提供，具体以商家说明为准。学生会不对商家的商品和服务质量承担责任，如有纠纷请与商家协商。',
      },
      {
        heading: '五、协议更新',
        body: '学生会可能根据需要更新本协议，更新后会在小程序内公布。继续使用本小程序即表示你同意更新后的协议。',
      },
    ],
  },
  privacy: {
    title: '隐私政策',
    sections: [
      {
        heading: '一、我们收集哪些信息',
        body: '1. 微信登录标识（openid），用于识别你的账号；\n2. 你主动设置的头像和昵称；\n3. 你用于学生认证的 Monash 学生邮箱；\n4. 你在论坛发布的文字和图片。',
      },
      {
        heading: '二、我们怎样使用这些信息',
        body: '1. 登录和识别你的身份；\n2. 验证学生身份、管理会员资格；\n3. 展示你发布的内容；\n4. 你发布的文字和图片会提交给微信的内容安全服务检测，以过滤违法违规内容；\n5. 处理举报和违规内容。',
      },
      {
        heading: '三、信息的存储和保护',
        body: '你的信息存储在位于澳大利亚的服务器上。我们只保存提供服务所必需的信息，不会出售你的个人信息。',
      },
      {
        heading: '四、你的权利',
        body: '你可以随时在「我的」页修改头像和昵称，也可以注销账号。注销后我们会删除你的头像、昵称、学生邮箱和会员资格；你发布过的帖子和评论会保留，作者显示为「已注销用户」。',
      },
      {
        heading: '五、联系我们',
        body: '如果你对本政策有任何疑问，请通过学生会的官方渠道联系我们。',
      },
    ],
  },
}

export function isAgreementType(value: string | undefined): value is AgreementType {
  return value === 'terms' || value === 'privacy'
}
