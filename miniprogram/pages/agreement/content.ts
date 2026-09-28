import type { PublicDeployment } from '../../deployment'

export type AgreementType = 'terms' | 'privacy'
export interface AgreementSection {
  heading: string
  body: string
}
export interface Agreement {
  title: string
  sections: AgreementSection[]
}
interface AgreementOptions {
  demo: boolean
  testing: boolean
  disclosure: PublicDeployment['disclosure'] | null
}

export function getAgreement(type: AgreementType, options: AgreementOptions): Agreement {
  const { demo, testing, disclosure } = options
  const operator = disclosure?.operatorName || '运营方尚未公布'
  const contact = disclosure?.supportContact || '「我的 → 意见反馈」'
  if (type === 'terms') {
    return {
      title: testing ? '内测使用说明' : '用户协议',
      sections: [
        {
          heading: '一、服务说明',
          body: demo
            ? '当前为功能演示，用于预览活动、商家、会员申请和文字论坛，不代表真实会员资格或商家优惠。'
            : `本服务由${operator}提供，用于浏览活动与商家、提交会员申请、文字交流和意见反馈。${testing ? '本版本仅供受邀用户测试。' : ''}`,
        },
        {
          heading: '二、会员申请',
          body: '验证 Monash 学生邮箱仅确认邮箱归属，申请须人工审核通过后才取得会员资格，有效期 12 个月；续期申请同样须审核。待审核不代表已取得资格，会员卡仅限本人使用。',
        },
        {
          heading: '三、论坛规则',
          body: '当前仅支持文字帖子和评论。请勿发布广告、色情低俗、人身攻击或违法违规内容。帖子与评论提交后须经人工审核，通过后公开；违规内容可被隐藏或删除，账号可被禁言。',
        },
        {
          heading: '四、商家和会员卡',
          body:
            testing || demo
              ? '标为示例的商家与活动仅用于展示；测试会员卡不作为正式优惠凭证。真实权益开放后，以运营方和商家确认的使用条件为准。'
              : '标为示例的商家与活动不代表真实优惠。实际优惠以商家公布的使用条件为准。',
        },
        {
          heading: '五、功能限制与联系',
          body: demo
            ? '头像修改与注销仅演示本地效果，不会处理真实服务中的账号。演示反馈不会发送给运营方。'
            : `头像上传、论坛图片和自助注销暂未开放。昵称可以修改；账号或数据处理请求可通过以下渠道提交：${contact}。提交请求不代表已完成注销或删除。`,
        },
      ],
    }
  }
  return {
    title: testing ? '内测隐私说明' : '隐私政策',
    sections: [
      {
        heading: '一、服务负责方',
        body: demo
          ? '当前为开发演示，不使用真实业务服务。'
          : `运营方：${operator}\n支持渠道：${contact}`,
      },
      {
        heading: '二、信息与用途',
        body: demo
          ? '演示使用示例身份，输入的邮箱、文字和反馈仅用于本地功能预览，不发送验证码邮件、不提交真实会员审核。'
          : '微信登录标识用于识别账号；你设置的昵称用于个人资料和内容署名；学生邮箱用于验证归属和人工审核会员资格。帖子、评论、举报、审核记录及反馈会保存用于交流、内容管理和问题处理。反馈联系方式由你自愿填写。头像与图片上传暂未开放。',
      },
      {
        heading: '三、位置与内容处理',
        body: demo
          ? '仅在点击附近优惠并授权时读取当前位置，用于显示商家直线距离。拒绝定位仍可浏览和搜索。内容审核仅用于演示流程。'
          : '仅在你点击附近优惠并授权时读取当前位置，用于计算与商家的直线距离；拒绝定位不影响浏览和搜索。昵称、帖子、评论及反馈文字会提交给微信内容安全服务检测，帖子和评论另需人工审核。请勿发布不必要的个人敏感信息。',
      },
      {
        heading: '四、保存安排',
        body: demo
          ? '演示业务与反馈只保存在本次运行的内存中，重新编译后清除；演示反馈不会发送给运营方。'
          : `真实服务会持久保存所提交的业务记录，退出或重新打开小程序不会自动删除。\n数据部署地区：${disclosure?.dataRegion || '尚未配置'}\n保存与处理安排：${disclosure?.retentionNotice || '尚未配置，请先向运营方确认。'}`,
      },
      {
        heading: '五、账号和数据请求',
        body: demo
          ? '可修改演示昵称、头像，或通过演示注销清除当前模拟身份；这些操作不会删除真实服务的数据。'
          : `你可以修改昵称、删除自己发布的帖子和评论。自助注销暂未开放；如需查询、更正、注销或删除个人数据，请通过${contact}提交请求，由运营方跟进处理。提交反馈不会自动删除账号，页面不会将请求显示为已完成注销。`,
      },
    ],
  }
}

export function isAgreementType(value: string | undefined): value is AgreementType {
  return value === 'terms' || value === 'privacy'
}
