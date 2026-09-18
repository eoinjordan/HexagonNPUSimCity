import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

/* ============================================================================
 * Debian package for the web build.
 *
 * `Architecture: all` because the payload is static files plus a shell
 * launcher, so one package installs on amd64 desktops and on arm64 Ubuntu
 * (Raspberry Pi) alike. python3 is in Ubuntu's base install, which keeps the
 * dependency set to a single stdlib HTTP server rather than a Node runtime.
 * ==========================================================================*/

export const PACKAGE = 'hexagon-npu-simcity'
export const ASSET = 'HexagonNPUSimCity-all.deb'
const INSTALL_DIR = `/usr/lib/${PACKAGE}`

/** Debian upstream versions may not contain a hyphen-free revision separator. */
export function debianVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Package version must be MAJOR.MINOR.PATCH')
  }
  return `${version}-1`
}

export function controlFile(version, installedKb) {
  if (!Number.isInteger(installedKb) || installedKb < 1) throw new Error('Installed-Size must be a positive integer')
  return [
    `Package: ${PACKAGE}`,
    `Version: ${debianVersion(version)}`,
    'Section: science',
    'Priority: optional',
    'Architecture: all',
    'Depends: python3 (>= 3.8)',
    'Maintainer: Eoin Jordan <eoinjordan@users.noreply.github.com>',
    `Installed-Size: ${installedKb}`,
    'Homepage: https://github.com/eoinjordan/HexagonNPUSimCity',
    'Description: Educational 3D visualization of the Qualcomm Hexagon NPU',
    ' Serves the HexagonNPUSimCity WebGL visualization from localhost and opens',
    ' it in the default browser. The figures shown are an illustrative teaching',
    ' model, not hardware measurements.',
    ' .',
    ' Independent, non-commercial project. Not affiliated with, sponsored by or',
    ' endorsed by Qualcomm.',
    '',
  ].join('\n')
}

export function launcher(port = 8770) {
  return `#!/bin/sh
# Serves the bundled build on loopback and opens a browser.
set -eu
PORT="\${HEXAGON_PORT:-${port}}"
cd "${INSTALL_DIR}/web"
python3 -m http.server "$PORT" --bind 127.0.0.1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' INT TERM EXIT
# Give the server a moment before handing the URL to the browser.
sleep 1
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || true
else
  echo "Open http://127.0.0.1:$PORT/ in a browser."
fi
wait $SERVER
`
}

export function desktopEntry() {
  return `[Desktop Entry]
Type=Application
Name=Hexagon NPU SimCity
Comment=Educational 3D visualization of the Qualcomm Hexagon NPU
Exec=${PACKAGE}
Terminal=false
Categories=Education;Science;
Keywords=NPU;Hexagon;visualization;
`
}

const run = promisify(execFile)

async function build() {
  const root = new URL('../', import.meta.url)
  const { version } = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('package.json', root), 'utf8'))
  const staging = new URL(`build/deb/${PACKAGE}/`, root)
  const outDir = new URL('release/linux/', root)

  await rm(staging, { recursive: true, force: true })
  await mkdir(new URL('DEBIAN/', staging), { recursive: true })
  await mkdir(new URL(`usr/lib/${PACKAGE}/`, staging), { recursive: true })
  await mkdir(new URL('usr/bin/', staging), { recursive: true })
  await mkdir(new URL('usr/share/applications/', staging), { recursive: true })
  await mkdir(new URL(`usr/share/doc/${PACKAGE}/`, staging), { recursive: true })
  await mkdir(outDir, { recursive: true })

  await cp(new URL('dist/', root), new URL(`usr/lib/${PACKAGE}/web/`, staging), { recursive: true })

  const { stdout } = await run('du', ['-sk', fileURLToPath(staging)])
  await writeFile(new URL('DEBIAN/control', staging), controlFile(version, Number.parseInt(stdout, 10) || 1))

  const binary = new URL(`usr/bin/${PACKAGE}`, staging)
  await writeFile(binary, launcher())
  await chmod(binary, 0o755)
  await writeFile(new URL(`usr/share/applications/${PACKAGE}.desktop`, staging), desktopEntry())
  await cp(new URL('LICENSE', root), new URL(`usr/share/doc/${PACKAGE}/copyright`, staging))

  const output = fileURLToPath(new URL(ASSET, outDir))
  try {
    await run('dpkg-deb', ['--root-owner-group', '--build', fileURLToPath(staging), output])
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.log(`Staged ${fileURLToPath(staging)}; install dpkg to build the package here.`)
    return
  }
  console.log(`Built ${output}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await build()
