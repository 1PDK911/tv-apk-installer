import { Modal } from './common'

/** First-run walkthrough, written for a TV remote. Menu paths checked October 2026. */
export function SetupGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Set up your TV (one time)" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        Use your TV remote: arrows to move, the centre button (<span className="kbd">OK</span>) to select,{' '}
        <span className="kbd">Back</span> to go back. Menu names vary slightly between brands.
      </p>
      <ol className="steps">
        <li>
          <div>
            <b>Open Settings.</b> On the Google TV home screen, go up to your profile picture (top-right) and select{' '}
            <span className="path">Settings</span>. On older Android TV, select the gear icon.
          </div>
        </li>
        <li>
          <div>
            <b>Unlock Developer options.</b> Go to <span className="path">System → About</span>, scroll down to{' '}
            <span className="path">Android TV OS build</span>, and press <span className="kbd">OK</span> <b>7 times</b> quickly.
            You may be asked for your PIN. A message says <i>“You are now a developer!”</i>
            <div className="muted small">
              Older Android TV: <span className="path">Device Preferences → About → Build</span>.
            </div>
          </div>
        </li>
        <li>
          <div>
            <b>Open Developer options.</b> Press <span className="kbd">Back</span> to <span className="path">System</span> and
            select <span className="path">Developer options</span> (older TVs: under Device Preferences).
          </div>
        </li>
        <li>
          <div>
            <b>Turn on debugging.</b> Which switch you have depends on the model:
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>
                If you see <span className="path">Wireless debugging</span> (Android TV 13+, e.g. Google TV Streamer): turn it
                on and allow it on your network. In this app use <b>Add TV → Wireless debugging</b>. You’ll use{' '}
                <span className="path">Pair device with pairing code</span> on the TV.
              </li>
              <li>
                Otherwise turn on <span className="path">USB debugging</span> (on Chromecast with Google TV and many TVs this
                also allows debugging over Wi-Fi), or <span className="path">Network debugging</span> / <span className="path">ADB debugging</span> if your TV has it. In this app use{' '}
                <b>Add TV → Network debugging (port 5555)</b>.
              </li>
            </ul>
          </div>
        </li>
        <li>
          <div>
            <b>Find the TV’s IP address.</b> With Wireless debugging it’s shown on that screen under{' '}
            <span className="path">IP address &amp; Port</span>. Otherwise go to{' '}
            <span className="path">Settings → Network &amp; Internet</span>, select your Wi-Fi network, and read{' '}
            <span className="path">IP address</span> (e.g. 192.168.1.42).
            <div className="muted small">
              Tip: reserve this address for the TV in your router so it doesn’t change.
            </div>
          </div>
        </li>
        <li>
          <div>
            <b>When you’re done installing,</b> turn debugging back off in Developer options. Leaving it on lets any paired
            or approved computer on your network control the TV.
          </div>
        </li>
      </ol>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  )
}
