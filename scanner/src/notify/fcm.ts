import type { CollectionReference } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import type { Notifier, PushMessage } from "./messages.js";

/** Error codes that mean a device token is permanently dead and should be removed. */
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
/** FCM multicast limit. */
const MAX_TOKENS = 500;

/**
 * Sends web push through Firebase Cloud Messaging to every registered browser
 * (documents in /spaces/{key}/devices, id = FCM token). With no registered
 * device it does nothing. Dead tokens are deleted so they are not retried.
 */
export class FcmNotifier implements Notifier {
  constructor(
    private readonly messaging: Pick<Messaging, "sendEachForMulticast">,
    private readonly devices: CollectionReference,
    /** Absolute HTTPS origin of the dashboard, e.g. https://example.web.app */
    private readonly dashboardUrl: string,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  async send(msg: PushMessage): Promise<void> {
    const tokens = (await this.devices.get()).docs.map((d) => d.id).slice(0, MAX_TOKENS);
    if (tokens.length === 0) {
      this.log("push skipped: no registered devices");
      return;
    }
    const res = await this.messaging.sendEachForMulticast({
      tokens,
      // The dashboard's service worker builds the notification from "data"
      // (FCM data values must be strings); "notification" is its fallback.
      data: { title: msg.title, body: msg.body, tag: msg.tag, link: msg.link, requireInteraction: msg.requireInteraction ? "1" : "0" },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        notification: { title: msg.title, body: msg.body, tag: msg.tag, requireInteraction: msg.requireInteraction, icon: "/icon-192.png" },
        fcmOptions: { link: this.dashboardUrl.replace(/\/$/, "") + msg.link },
      },
    });
    let removed = 0;
    for (const [i, r] of res.responses.entries()) {
      if (!r.success && DEAD_TOKEN.has(r.error?.code ?? "")) {
        await this.devices.doc(tokens[i]!).delete();
        removed++;
      }
    }
    // Counts only: tokens and message text never go to the (public) workflow log.
    this.log(`push sent: ok=${res.successCount} failed=${res.failureCount} removed=${removed}`);
  }
}
