import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { isIP } from 'node:net'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MINI = path.join(ROOT, 'miniprogram')
const ALLOWED_FILES = /\.(ts|js|json|wxss|wxml|wxs|png|jpe?g|webp|gif|svg|woff2?|ttf)$/
const RUNTIME_EXTENSIONS = ['.ts', '.js', '.json', '.wxml', '.wxss', '.wxs']
const DISCLOSURES = ['operatorName', 'supportContact', 'dataRegion', 'retentionNotice']

function fail(message) {
  throw new Error(message)
}

function argumentsOf(argv) {
  const options = { check: false, config: '', output: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--help') {
      console.log(
        'Usage: node scripts/prepare-trial.mjs --config PUBLIC_JSON [--check | --output NEW_DIRECTORY]',
      )
      console.log(
        'No upload or network requests. Checks public configuration, types and local package dependencies.',
      )
      process.exit(0)
    } else if (arg === '--config' || arg === '--output') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) fail(`Missing value for ${arg}.`)
      options[arg.slice(2)] = argv[++index]
    } else fail('Unknown argument. Use --help.')
  }
  if (!options.config) fail('A real public deployment configuration is required: --config PATH.')
  if (options.check && options.output) fail('--check does not create an output directory.')
  return options
}

function exactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) {
    fail(`${label} must contain only its documented public fields; do not include secrets.`)
  }
}

function publicConfig(configPath) {
  const source = readFileSync(configPath, 'utf8')
  if (Buffer.byteLength(source) > 16384) fail('Public configuration is too large.')
  let config
  try {
    config = JSON.parse(source)
  } catch {
    fail('Public configuration must be valid JSON.')
  }
  exactKeys(config, ['apiBaseUrl', 'version', 'disclosure'], 'Configuration')
  exactKeys(config.disclosure, DISCLOSURES, 'disclosure')
  if (typeof config.apiBaseUrl !== 'string' || !config.apiBaseUrl.trim())
    fail('apiBaseUrl is required.')
  let url
  try {
    url = new URL(config.apiBaseUrl)
  } catch {
    fail('apiBaseUrl must be a real HTTPS API URL.')
  }
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/api/v1' ||
    url.search ||
    url.hash ||
    isIP(host) ||
    host.includes(':') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host) ||
    /(?:^|\.)(?:localhost|local|test|invalid|example)$/.test(host) ||
    /(?:^|\.)example\.(?:com|net|org)$/.test(host) ||
    /(?:placeholder|your[-.]|change[-.]?me)/i.test(host) ||
    url.href !== config.apiBaseUrl
  ) {
    fail(
      'apiBaseUrl must be a public HTTPS hostname ending exactly in /api/v1, without credentials, query, port or placeholders.',
    )
  }
  if (
    typeof config.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(config.version) ||
    config.version.length > 48
  )
    fail('version must be a release version such as 0.1.0.')
  for (const field of DISCLOSURES) {
    const value = config.disclosure[field]
    if (
      typeof value !== 'string' ||
      value !== value.trim() ||
      value.length < 2 ||
      value.length > 1200 ||
      /(?:待填写|待确认|尚未配置|placeholder|change[- ]?me|todo|tbd)/i.test(value)
    ) {
      fail(`disclosure.${field} must contain confirmed public information, not a placeholder.`)
    }
  }
  return config
}

function isInside(file) {
  return file.startsWith(`${MINI}${path.sep}`)
}

function resolveReference(from, reference) {
  if (/^(https?:|data:|wx:)/.test(reference) || reference.includes('{{')) return []
  const roots = []
  if (reference.startsWith('/')) roots.push(path.join(MINI, reference.slice(1)))
  else if (reference.startsWith('.')) roots.push(path.resolve(path.dirname(from), reference))
  else {
    for (
      let directory = path.dirname(from);
      directory.startsWith(MINI);
      directory = path.dirname(directory)
    ) {
      roots.push(path.join(directory, 'miniprogram_npm', reference))
    }
  }
  for (const root of roots) {
    if (!isInside(root)) fail('A package dependency escapes the mini-program directory.')
    if (existsSync(root) && lstatSync(root).isFile()) return [root]
    for (const stem of [root, path.join(root, 'index')]) {
      const matches = RUNTIME_EXTENSIONS.map((ext) => stem + ext).filter(existsSync)
      if (matches.length) return matches
    }
  }
  fail(`Missing local runtime dependency: ${path.relative(MINI, from)} -> ${reference}`)
}

function dependencies(file, content) {
  const refs = new Set()
  if (/\.(ts|js|wxs)$/.test(file)) {
    const info = ts.preProcessFile(content, true, true)
    for (const dependency of info.importedFiles) {
      // UMD bundles declare these AMD pseudo-dependencies, not package files.
      if (!['exports', 'require', 'module'].includes(dependency.fileName))
        refs.add(dependency.fileName)
    }
  }
  if (file.endsWith('.json')) {
    const json = JSON.parse(content)
    for (const reference of Object.values(json.usingComponents ?? {})) refs.add(reference)
  }
  if (/\.(wxml|wxss)$/.test(file)) {
    for (const match of content.matchAll(
      /(?:\b(?:src|href)\s*=\s*["']|@import\s+["'])([^"']+)["']/g,
    ))
      refs.add(match[1])
    for (const match of content.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) refs.add(match[1])
  }
  return [...refs].flatMap((reference) => resolveReference(file, reference))
}

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'miniprogram_npm' || entry.name.startsWith('.')) continue
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) fail('Symlinks are not allowed in the trial source tree.')
    if (entry.isDirectory()) files.push(...sourceFiles(file))
    else if (ALLOWED_FILES.test(file) && !file.endsWith('.d.ts')) files.push(file)
  }
  return files
}

function buildFiles(config) {
  const queue = sourceFiles(MINI)
  const visited = new Set()
  const output = new Map()
  while (queue.length) {
    const file = queue.shift()
    if (visited.has(file)) continue
    visited.add(file)
    if (lstatSync(file).isSymbolicLink()) fail('Symlinks are not allowed in runtime dependencies.')
    let data = readFileSync(file)
    let relative = path.relative(MINI, file)
    if (/\.(ts|js|json|wxml|wxss|wxs)$/.test(file)) {
      let source = data.toString('utf8')
      if (relative === 'deployment.generated.ts') {
        source = `export const PUBLIC_DEPLOYMENT = ${JSON.stringify(config)}\n`
      }
      queue.push(...dependencies(file, source))
      if (/\.(ts|js)$/.test(file)) {
        const result = ts.transpileModule(source, {
          fileName: file,
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
            removeComments: true,
            sourceMap: false,
          },
          reportDiagnostics: true,
        })
        if (
          result.diagnostics?.some(
            (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
          )
        ) {
          fail(`Cannot compile ${relative}.`)
        }
        data = Buffer.from(result.outputText)
        relative = relative.replace(/\.ts$/, '.js')
      }
    }
    output.set(relative, data)
  }
  const app = JSON.parse(output.get('app.json').toString())
  for (const page of [...app.pages, 'custom-tab-bar/index']) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      if (!output.has(page + extension)) fail(`Missing page artifact: ${page}${extension}`)
    }
  }
  return output
}

function typecheck() {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--project',
      path.join(ROOT, 'tsconfig.json'),
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    process.stderr.write(result.stdout || result.stderr || 'TypeScript check failed.\n')
    fail('TypeScript errors must be fixed before preparing a trial build.')
  }
}

function main() {
  const options = argumentsOf(process.argv.slice(2))
  const config = publicConfig(path.resolve(options.config))
  typecheck()
  const files = buildFiles(config)
  const packageBytes = [...files.values()].reduce((sum, data) => sum + data.length, 0)
  // Apply a conservative local size budget. Developer tools perform the
  // authoritative package compilation and size check at the final gate.
  if (packageBytes > 1.9 * 1024 * 1024)
    fail('Prepared main package exceeds the conservative 1.9 MiB local limit.')
  const sourceProject = JSON.parse(readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'))
  if (!/^wx[0-9a-f]{16}$/.test(sourceProject.appid ?? '')) {
    fail('project.config.json must contain the actual mini-program AppID.')
  }
  if (!/^\d+\.\d+\.\d+$/.test(sourceProject.libVersion ?? '')) {
    fail('project.config.json must pin an observed numeric base-library version.')
  }
  const summary = {
    version: config.version,
    apiBaseUrl: config.apiBaseUrl,
    files: files.size,
    packageBytes,
    uploaded: false,
    synthetic: /synthetic/i.test(config.version),
  }
  if (options.check) {
    console.log(
      JSON.stringify({ ...summary, status: 'local-check-passed', networkVerified: false }),
    )
    return
  }
  const output = path.resolve(options.output || path.join(ROOT, 'artifacts/trial', config.version))
  if (output === MINI || isInside(output) || MINI.startsWith(`${output}${path.sep}`))
    fail('Output must be isolated from the source project.')
  if (existsSync(output)) fail('Output directory already exists; trial builds never overwrite it.')
  mkdirSync(path.dirname(output), { recursive: true })
  mkdirSync(output)
  for (const [relative, data] of files) {
    const target = path.join(output, 'miniprogram', relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, data, { flag: 'wx' })
  }
  const project = {
    appid: sourceProject.appid,
    projectname: `monash-trial-${config.version}`,
    compileType: 'miniprogram',
    miniprogramRoot: 'miniprogram/',
    libVersion: sourceProject.libVersion,
    setting: {
      es6: true,
      enhance: true,
      postcss: true,
      minified: true,
      minifyWXSS: true,
      minifyWXML: true,
      urlCheck: true,
      useCompilerPlugins: [],
      ignoreDevUnusedFiles: true,
      uploadWithSourceMap: false,
    },
  }
  writeFileSync(path.join(output, 'project.config.json'), JSON.stringify(project, null, 2) + '\n', {
    flag: 'wx',
  })
  const manifest = {
    ...summary,
    preparedAt: new Date().toISOString(),
    status: 'prepared-not-uploaded',
    networkVerified: false,
    files: Object.fromEntries(
      [...files].map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')]),
    ),
  }
  writeFileSync(
    path.join(output, 'trial-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  )
  console.log(
    JSON.stringify({ ...summary, output, status: 'prepared-not-uploaded', networkVerified: false }),
  )
}

try {
  main()
} catch (error) {
  console.error(
    `Trial preparation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  )
  process.exitCode = 1
}
