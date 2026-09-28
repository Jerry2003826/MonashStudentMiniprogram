import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const PACKAGE = 'tdesign-miniprogram'

// Reject links in every ancestor as well as the copied tree. This command owns
// only its generated package directory, never the source package or app assets.
function checkedPath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').some((part) => !part || part === '..' || part === '.')
  )
    throw new Error('Component path must stay inside its declared directory.')
  let current = root
  for (const part of relative.split('/')) {
    current = path.join(current, part)
    // lstat also detects dangling links, unlike existsSync.
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in component paths.')
  }
  return current
}

function filesIn(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in component trees.')
    if (entry.isDirectory()) files.push(...filesIn(file, relative))
    else if (entry.isFile()) files.push(relative)
    else throw new Error('Only regular files and directories are allowed in component trees.')
  }
  return files.sort()
}

function prepare() {
  const packageDirectory = checkedPath(ROOT, `node_modules/${PACKAGE}`)
  const metadata = JSON.parse(readFileSync(checkedPath(packageDirectory, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(checkedPath(ROOT, 'package-lock.json'), 'utf8'))
  const lockedVersion = lock.packages?.[`node_modules/${PACKAGE}`]?.version
  if (metadata.name !== PACKAGE || !lockedVersion || metadata.version !== lockedVersion)
    throw new Error('Installed component version does not match package-lock.json. Run npm ci.')
  const source = checkedPath(packageDirectory, metadata.miniprogram)
  const files = filesIn(source)
  if (!files.length) throw new Error('Published component distribution is empty.')

  const outputRoot = checkedPath(ROOT, 'miniprogram/miniprogram_npm')
  const output = checkedPath(ROOT, `miniprogram/miniprogram_npm/${PACKAGE}`)
  if (existsSync(output)) filesIn(output)
  mkdirSync(outputRoot, { recursive: true })
  const temporary = mkdtempSync(path.join(outputRoot, '.prepare-components-'))
  const prepared = path.join(temporary, PACKAGE)
  let bytes = 0
  try {
    for (const relative of files) {
      const destination = path.join(prepared, relative)
      mkdirSync(path.dirname(destination), { recursive: true })
      copyFileSync(path.join(source, relative), destination)
      bytes += lstatSync(destination).size
    }
    // Validation and copying finish before replacing this generated directory.
    // Other packages under miniprogram_npm and our embedded fonts stay intact.
    rmSync(output, { recursive: true, force: true })
    renameSync(prepared, output)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  console.log(
    JSON.stringify({
      package: PACKAGE,
      version: metadata.version,
      files: files.length,
      bytes,
      output,
    }),
  )
}

try {
  if (process.argv.length > 2) throw new Error('Usage: npm run prepare:components (no arguments).')
  prepare()
} catch (error) {
  console.error(`Component preparation failed: ${error.message}`)
  process.exitCode = 1
}
