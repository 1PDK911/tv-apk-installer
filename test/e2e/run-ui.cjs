// End-to-end UI run against the fake adb in this folder (no TV needed).
// Optional: requires Playwright (`npm i -D playwright` or a global install)
// and a built app (`npm run build`). Screenshots go to test/e2e/screenshots/.
//   node test/e2e/run-ui.cjs
const path = require('path')
const fs = require('fs')
const os = require('os')
let playwright
try {
  playwright = require('playwright')
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright')
  process.exit(1)
}
const APP = path.resolve(__dirname, '../..')
const FIX = path.join(APP, 'test/fixtures/apk')
const OUT = path.join(__dirname, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tvapk-e2e-'))
const electronBin = require(path.join(APP, 'node_modules/electron'))

;(async () => {
  const app = await playwright._electron.launch({
    executablePath: electronBin,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), APP, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      PATH: `${path.join(__dirname, 'bin')}${path.delimiter}${process.env.PATH}`,
      FAKE_ADB_STATE: path.join(userData, 'fake-adb.json')
    }
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const shot = (n) => win.screenshot({ path: path.join(OUT, `${n}.png`) })
  const step = (s) => console.log(`• ${s}`)

  step('setup guide')
  await win.getByRole('button', { name: 'Got it' }).click()
  step('add TV (network debugging) and wait for approval')
  await win.getByRole('button', { name: '+ Add TV' }).click()
  await win.getByRole('button', { name: /Network debugging/ }).click()
  await win.locator('.discovered .tv-item').first().click()
  await win.getByRole('button', { name: 'Connect', exact: true }).click()
  await win.getByText('Almost there').waitFor()
  await win.getByRole('button', { name: 'Done' }).click()
  await win.locator('.topbar .chip.ok').waitFor({ timeout: 15000 })
  await shot('01-connected')

  step('queue files')
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
  }, ['tv-app.apk', 'app.xapk', 'encrypted.apkm'].map((f) => path.join(FIX, f)))
  await win.locator('.dropzone').click()
  await win.getByText('Example TV App').first().waitFor()
  await shot('02-queue')

  step('install → signature mismatch → uninstall & reinstall')
  const first = win.locator('.queue-item').nth(0)
  await first.getByRole('button', { name: 'Install', exact: true }).click()
  await first.getByText('INSTALL_FAILED_UPDATE_INCOMPATIBLE').waitFor()
  await first.getByRole('button', { name: 'Uninstall & reinstall…' }).click()
  await first.getByRole('button', { name: 'Uninstall & reinstall', exact: true }).click()
  await first.getByRole('button', { name: 'Open on TV' }).click()
  await first.getByText('Opened on the TV.').waitFor()
  await shot('03-installed')

  step('install bundle')
  const second = win.locator('.queue-item').nth(1)
  await second.getByRole('button', { name: 'Install', exact: true }).click()
  await second.getByRole('button', { name: 'Open on TV' }).waitFor()
  await win.locator('.queue-item').nth(2).getByText('encrypted').first().waitFor()

  step('app manager')
  await win.getByRole('tab', { name: 'Apps on TV' }).click()
  await win.locator('tr', { hasText: 'com.netflix.ninja' }).waitFor()
  await win.locator('tr', { hasText: 'com.netflix.ninja' }).getByRole('button', { name: 'Uninstall' }).click()
  await win.getByRole('dialog').getByRole('button', { name: 'Uninstall' }).click()
  await win.locator('tr', { hasText: 'com.netflix.ninja' }).waitFor({ state: 'detached' })
  await shot('04-apps')

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
  if (errors.length) {
    console.error('Renderer errors:', errors)
    process.exit(1)
  }
  console.log(`✓ UI run passed. Screenshots in ${OUT}`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
