import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function checkReleaseVersion(tag, version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || tag !== `v${version}`) throw new Error('Release tag must exactly match the stable package.json version (vMAJOR.MINOR.PATCH)')
  const parts = version.split('.').map(Number)
  if (parts[0] > 255 || parts[1] > 255 || parts[2] > 65535) throw new Error('Version exceeds Windows Installer version limits')
  return version
}

export function checksum(name, bytes) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Unsafe release asset name')
  return `${createHash('sha256').update(bytes).digest('hex')}  ${name}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--version-output')) {
    const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const version = checkReleaseVersion(`v${metadata.version}`, metadata.version)
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`)
  } else if (process.argv.includes('--check-version')) {
    const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    console.log(`Release version verified: ${checkReleaseVersion(process.env.RELEASE_TAG, metadata.version)}`)
  } else if (process.argv.includes('--checksums')) {
    const directory = new URL('../release/', import.meta.url)
    const required = ['HexagonNPUSimCity-web.zip', 'HexagonNPUSimCity-arm64-cpu-preview.apk', 'HexagonNPUSimCity-arm64.msi']
    const files = await readdir(directory)
    for (const name of required) if (!files.includes(name)) throw new Error(`Missing release asset: ${name}`)
    const lines = await Promise.all(required.sort().map(async (name) => checksum(name, await readFile(new URL(name, directory)))))
    await writeFile(new URL('SHA256SUMS', directory), lines.join('\n') + '\n')
    console.log('All three platform assets present; SHA256SUMS written')
  } else {
    throw new Error('Specify --check-version or --checksums')
  }
}