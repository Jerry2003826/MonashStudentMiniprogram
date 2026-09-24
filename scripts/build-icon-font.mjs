// 把 TDesign 图标字体裁剪成只包含用到的图标，内嵌成 base64 写进 miniprogram/styles/icon-font.wxss。
// TDesign 默认从腾讯 CDN 在线加载整套字体，在澳洲经常很慢，开发者工具里也经常加载失败。
// 页面里要用新图标时，把名字加进 APP_ICONS，然后运行 npm run build:icons。

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import subsetFont from 'subset-font'

const APP_ICONS = [
  'add',
  'browse',
  'calendar',
  'call',
  'card',
  'chat',
  'chat-bubble-1',
  'chat-message',
  'chevron-right',
  'close',
  'copy',
  'delete',
  'discount',
  'edit',
  'ellipsis',
  'file',
  'gift',
  'home',
  'image',
  'info-circle',
  'location',
  'lock-on',
  'logout',
  'mail',
  'more',
  'notification',
  'pin',
  'search',
  'secured',
  'shop',
  'thumb-up',
  'thumb-up-filled',
  'time',
  'user',
]

const ROOT = path.resolve(import.meta.dirname, '..')
const TDESIGN_DIST = path.join(ROOT, 'node_modules/tdesign-miniprogram/miniprogram_dist')
const ICON_WXSS = path.join(TDESIGN_DIST, 'icon/icon.wxss')
const OUTPUT = path.join(ROOT, 'miniprogram/styles/icon-font.wxss')
const CACHE_DIR = path.join(ROOT, 'node_modules/.cache/tdesign-icons')
const FONT_FAMILY = 'app-icons'

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(js|wxml)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

// TDesign 组件内部用到的图标名散落在各组件的 js 和 wxml 里，取和字形表的交集
async function findInternalIcons(glyphNames) {
  const used = new Set()
  for (const file of await listFiles(TDESIGN_DIST)) {
    const source = await readFile(file, 'utf8')
    for (const [, token] of source.matchAll(/["']([a-z0-9]+(?:-[a-z0-9]+)*)["']/g)) {
      if (glyphNames.has(token)) used.add(token)
    }
  }
  return used
}

async function loadFont(url) {
  const cacheFile = path.join(CACHE_DIR, url.replace(/[^a-z0-9.]+/gi, '_'))
  try {
    return await readFile(cacheFile)
  } catch {
    console.log(`下载 ${url}（从澳洲访问可能要等一两分钟）`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`下载字体失败：HTTP ${response.status}`)
    const font = Buffer.from(await response.arrayBuffer())
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cacheFile, font)
    return font
  }
}

async function main() {
  const wxss = await readFile(ICON_WXSS, 'utf8')
  const fontUrl = wxss.match(/url\((https:[^)]+\.woff)\)/)?.[1]
  if (!fontUrl) throw new Error(`没有在 ${ICON_WXSS} 里找到字体地址`)

  const glyphs = new Map(
    [...wxss.matchAll(/\.t-icon-([a-z0-9-]+):before\{content:'\\([0-9A-Fa-f]+)'/g)].map(
      ([, name, code]) => [name, Number.parseInt(code, 16)],
    ),
  )
  const unknown = APP_ICONS.filter((name) => !glyphs.has(name))
  if (unknown.length > 0) {
    throw new Error(`TDesign 图标库里没有这些图标：${unknown.join(', ')}`)
  }

  const names = new Set([...(await findInternalIcons(new Set(glyphs.keys()))), ...APP_ICONS])
  const text = [...names].map((name) => String.fromCodePoint(glyphs.get(name))).join('')
  const subset = await subsetFont(await loadFont(fontUrl), text, { targetFormat: 'woff' })

  const css = [
    '/* 由 scripts/build-icon-font.mjs 生成，不要手改。要加图标请改脚本里的 APP_ICONS。 */',
    '@font-face {',
    `  font-family: '${FONT_FAMILY}';`,
    `  src: url('data:font/woff;base64,${subset.toString('base64')}') format('woff');`,
    '  font-weight: normal;',
    '  font-style: normal;',
    '}',
    '',
    '/* 双重类名是为了盖过 TDesign 自带的 .t-icon { font-family: t !important } */',
    '.t-icon.t-icon {',
    `  font-family: '${FONT_FAMILY}' !important;`,
    '}',
    '',
  ].join('\n')

  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, css)
  console.log(
    `已生成 ${path.relative(ROOT, OUTPUT)}：${names.size} 个图标，${(css.length / 1024).toFixed(1)} KB`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
