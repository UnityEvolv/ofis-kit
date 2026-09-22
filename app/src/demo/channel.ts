/**
 * What passes between tabs in the in-browser demo.
 *
 * One tab hosts the office: it runs the real engine, as the server process would.
 * Every tab, the host's own included, talks to it through a BroadcastChannel with
 * these messages, which stand in for what Socket.IO carries between a browser and
 * the server. BroadcastChannel reaches every tab of this site in this browser and
 * nothing else, which is exactly the reach the demo has: one device, no network.
 */

import type { DeviceKind } from '@unityevolv/ofiskit-realtime-core/portable'

/** A tab talking to the host. */
export type ToHost =
  /** A connection opening, or opening again after the host changed. */
  | { kind: 'hello'; conn: string; deviceId: string; device: DeviceKind }
  /** An event, with an acknowledgement number when the sender waits for a reply. */
  | { kind: 'emit'; conn: string; event: string; args: unknown[]; ack?: number }
  /** A connection closing on purpose: the tab closed, or the client left. */
  | { kind: 'bye'; conn: string }

/** The host talking to tabs. */
export type ToClient =
  /** A hello was answered: this connection is up. */
  | { kind: 'welcome'; to: string; host: string }
  /** An event for these connections. One message, however many receive it. */
  | { kind: 'event'; to: string[]; event: string; args: unknown[] }
  | { kind: 'ack'; to: string; ack: number; result: unknown }
  /**
   * A new host is running. Sent when a tab takes over, which is when the old one
   * closed: every connection says hello again, as a client reconnects after a
   * server restart, and the office is rebuilt from who is still here.
   */
  | { kind: 'host'; host: string }

export type DemoMessage = ToHost | ToClient

/** The channel for one office. Per office, so two offices on one site never mix. */
export function channelName(officeId: string): string {
  return `ofiskit-demo:${officeId}`
}
