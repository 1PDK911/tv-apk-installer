import type { ConnectMethod, TvState } from './types'

export interface StatusCopy {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  nextStep: string
}

/** Plain-English label plus the exact next step for every TV state. */
export function describeState(state: TvState, method: ConnectMethod): StatusCopy {
  switch (state) {
    case 'connected':
      return { label: 'Connected', tone: 'ok', nextStep: 'Ready. Drop an APK to install it.' }
    case 'connecting':
      return { label: 'Connecting…', tone: 'muted', nextStep: 'Talking to the TV…' }
    case 'unauthorized':
      return {
        label: 'Waiting for approval on TV',
        tone: 'warn',
        nextStep:
          'Look at the TV: an "Allow debugging?" dialog should be showing. Tick "Always allow from this computer", then select Allow. If no dialog appears, click Reconnect.'
      }
    case 'offline':
      return {
        label: 'Offline',
        tone: 'bad',
        nextStep:
          'The TV stopped responding. Make sure it is on (not in standby) and on the same Wi-Fi, then click Reconnect.'
      }
    case 'not_paired':
      return {
        label: 'Not paired',
        tone: 'warn',
        nextStep:
          'This computer isn’t paired with the TV. On the TV open Developer options → Wireless debugging → "Pair device with pairing code", then click Pair and enter the code.'
      }
    case 'port_changed':
      return {
        label: 'Port changed',
        tone: 'warn',
        nextStep:
          'The TV’s wireless debugging port changes after a restart. On the TV open Developer options → Wireless debugging and enter the IP address & Port shown there.'
      }
    case 'unreachable':
      return {
        label: 'Can’t reach TV',
        tone: 'bad',
        nextStep:
          method === 'wireless'
            ? 'Check the TV is on, on the same Wi-Fi as this computer, and that Wireless debugging is still switched on (it turns off after a restart on some TVs).'
            : 'Check the TV is on, on the same Wi-Fi as this computer, and that USB/Network debugging is switched on in Developer options.'
      }
    case 'disconnected':
    default:
      return { label: 'Disconnected', tone: 'muted', nextStep: 'Click Connect to reconnect to this TV.' }
  }
}

/** "Google" + "Google TV Streamer" → "Google TV Streamer"; "Sony" + "BRAVIA 4K" → "Sony BRAVIA 4K". */
export function displayModel(manufacturer: string | undefined, model: string | undefined): string | undefined {
  if (!model) return manufacturer
  if (!manufacturer || model.toLowerCase().startsWith(manufacturer.toLowerCase())) return model
  return `${manufacturer} ${model}`
}
