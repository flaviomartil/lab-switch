import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function runnable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findBrowser(env = process.env) {
  if (env.LAB_BROWSER) return runnable(env.LAB_BROWSER) ? env.LAB_BROWSER : null
  const apps = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ]
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave']
  const fromPath = (env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(folder => names.map(name => join(folder, name)))
  return [...apps, ...fromPath].find(runnable) ?? null
}

export async function capturePage(browser, url, file) {
  const profile = await mkdtemp(join(tmpdir(), 'lab-print-'))
  try {
    await run(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile, '--window-size=1280,800', '--virtual-time-budget=4000',
      '--screenshot=' + file, url,
    ], { timeout: 30_000 })
    return (await stat(file)).size > 0
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
}
