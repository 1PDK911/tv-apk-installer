#!/usr/bin/env node
// A fake `adb` that behaves like one Google TV, for end-to-end UI tests only.
// Never shipped. State lives in $FAKE_ADB_STATE (JSON).
const fs = require('fs')
const STATE = process.env.FAKE_ADB_STATE || '/tmp/fake-adb-state.json'
const TV = '192.168.1.42'
const load = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return {
      connected: false,
      authorized: false,
      installed: { 'com.netflix.ninja': { versionName: '8.120.0', versionCode: 120 }, 'com.example.tvapp': { versionName: '1.0.0', versionCode: 1 } }
    }
  }
}
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s))
const out = (s) => process.stdout.write(s.endsWith('\n') ? s : s + '\n')
let args = process.argv.slice(2)
let serial
if (args[0] === '-s') {
  serial = args[1]
  args = args.slice(2)
}
const st = load()
const cmd = args[0]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (st.approveAt && Date.now() > st.approveAt) {
  st.authorized = true
  delete st.approveAt
  save(st)
}

;(async () => {
  switch (cmd) {
    case 'version':
      return out('Android Debug Bridge version 1.0.41\nVersion 36.0.2-fake\nInstalled as fake\nRunning on test')
    case 'devices':
      return out(`List of devices attached\n${st.connected ? `${TV}:5555\t${st.authorized ? 'device product:kirkwood model:Google_TV_Streamer device:kirkwood transport_id:1' : 'unauthorized transport_id:1'}\n` : ''}`)
    case 'connect': {
      if (args[1] !== `${TV}:5555`) return out(`failed to connect to '${args[1]}': Connection timed out`)
      const already = st.connected
      st.connected = true
      // First connect needs approval on the TV; it "arrives" 3 seconds later.
      if (!st.authorized && !st.approveAt) st.approveAt = Date.now() + 3000
      save(st)
      return out(`${already ? 'already ' : ''}connected to ${args[1]}`)
    }
    case 'disconnect':
      st.connected = false
      save(st)
      return out(`disconnected ${args[1] ?? 'everything'}`)
    case 'mdns':
      return out(`List of discovered mdns services\nadb-FAKE123456-AbCdEf\t_adb._tcp\t${TV}:5555`)
    case 'pair':
      return out('Failed: Wrong password or connection was dropped.')
    case 'kill-server':
    case 'start-server':
      return
    case 'install':
    case 'install-multiple': {
      const file = args[args.length - 1]
      await sleep(1500)
      if (/phone-app/.test(file) && !args.includes('-t')) return out('Performing Streamed Install\nadb: failed to install x.apk: Failure [INSTALL_FAILED_TEST_ONLY: installPackageLI]')
      if (/tv-app/.test(file) && !st.uninstalledTvApp) return out('Performing Streamed Install\nadb: failed to install x.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.example.tvapp signatures do not match newer version; ignoring!]')
      const pkg = /tv-app/.test(file) ? 'com.example.tvapp' : /phone-app/.test(file) ? 'org.example.phoneonly' : 'com.example.splitapp'
      st.installed[pkg] = { versionName: pkg === 'com.example.tvapp' ? '1.2.0' : pkg === 'org.example.phoneonly' ? '7.0-beta' : '1.2.0', versionCode: 3 }
      save(st)
      return out(cmd === 'install' ? 'Performing Streamed Install\nSuccess' : 'Success')
    }
    case 'uninstall':
      if (args[1] === 'com.example.tvapp') st.uninstalledTvApp = true
      delete st.installed[args[1]]
      save(st)
      return out('Success')
    case 'push':
      return out(`${args[1]}: 1 file pushed, 0 skipped. 20.1 MB/s (700 bytes in 0.001s)`)
    case 'pull':
      fs.writeFileSync(args[2], 'PK fake apk')
      return out(`${args[1]}: 1 file pulled, 0 skipped. 30 MB/s`)
    case 'exec-out':
      if (args[1] === 'screencap') {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
        return process.stdout.write(png)
      }
      return
    case 'shell': {
      const sh = args.slice(1).join(' ')
      if (sh === 'getprop')
        return out(
          ['ro.product.manufacturer=Google', 'ro.product.model=Google TV Streamer', 'ro.build.version.release=14', 'ro.build.version.sdk=34', 'ro.product.cpu.abilist=arm64-v8a,armeabi-v7a,armeabi', 'ro.serialno=FAKE123456', 'persist.sys.locale=en-US']
            .map((l) => l.split('='))
            .map(([k, v]) => `[${k}]: [${v}]`)
            .join('\n')
        )
      if (sh === 'df -k /data') return out('Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/block/dm-5 25165824 18874368 6291456  75% /data')
      if (sh === 'wm density') return out('Physical density: 320')
      if (sh === 'dumpsys package packages')
        return out('Packages:\n' + Object.entries(st.installed).map(([pkg, p]) => `  Package [${pkg}] (abc):\n    versionCode=${p.versionCode} minSdk=21 targetSdk=33\n    versionName=${p.versionName}\n    installerPackageName=${pkg === 'com.netflix.ninja' ? 'com.android.vending' : 'null'}\n`).join(''))
      if (sh === 'pm list packages -3 -d') return out('')
      if (sh.startsWith('dumpsys package ')) {
        const pkg = sh.split(' ')[2]
        const p = st.installed[pkg]
        return out(p ? `Packages:\n  Package [${pkg}] (abc):\n    codePath=/data/app/${pkg}-1\n    versionCode=${p.versionCode} minSdk=21 targetSdk=33\n    versionName=${p.versionName}\n` : 'Unable to find package')
      }
      if (sh.startsWith('pm list packages')) return out(Object.keys(st.installed).map((p) => `package:/data/app/${p}-1/base.apk=${p}`).join('\n'))
      if (sh.startsWith('pm path ')) return out(`package:/data/app/${sh.split(' ')[2]}-1/base.apk`)
      if (sh.includes('resolve-activity')) return out(sh.includes('LEANBACK') && !sh.includes('phoneonly') ? `${sh.split(' ').pop()}/.MainActivity` : sh.includes('phoneonly') && !sh.includes('LEANBACK') ? 'org.example.phoneonly/.Main' : 'No activity found')
      if (sh.startsWith('am start')) return out('Starting: Intent { act=android.intent.action.MAIN }')
      if (sh.startsWith('am force-stop') || sh.startsWith('input keyevent') || sh.startsWith('mkdir')) return
      return out(`/system/bin/sh: ${sh}: not found`)
    }
    default:
      process.stderr.write(`fake adb: unknown command ${args.join(' ')}\n`)
      process.exit(1)
  }
})()
