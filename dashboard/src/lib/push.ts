import { getApp } from "firebase/app";
import type { DataSource } from "../data/source";
import { vapidKey } from "../firebaseConfig";

/**
 * Push notifications for this browser. Turning them on asks the browser for
 * permission, registers the service worker, gets a Firebase Cloud Messaging
 * token and stores it under your space (devices/{token}); the scanner sends to
 * every stored token. Nothing here runs until you click "Turn on".
 */
export type PushStatus = "demo" | "unconfigured" | "unsupported" | "blocked" | "off" | "on";

const TOKEN = "jobfinder.pushToken";
const SEEN = "jobfinder.pushSeenDay";
const SW_URL = "/firebase-messaging-sw.js";

const store = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    } catch {
      // Private mode: the browser will simply ask again next time.
    }
  },
};

const today = () => new Date().toISOString().slice(0, 10);

export function pushStatus(source: DataSource): PushStatus {
  if (source.demo) return "demo";
  if (!vapidKey) return "unconfigured";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && store.get(TOKEN) ? "on" : "off";
}

async function fetchToken(): Promise<string> {
  // Loaded on demand so the messaging SDK is not part of the first page load.
  const { getMessaging, getToken } = await import("firebase/messaging");
  const registration = await navigator.serviceWorker.register(SW_URL);
  const token = await getToken(getMessaging(getApp()), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error("The browser did not return a push token.");
  return token;
}

/** Store the current token; drop the previous one if the browser rotated it. */
async function sync(source: DataSource, token: string): Promise<void> {
  const previous = store.get(TOKEN);
  await source.saveDevice(token, previous !== token);
  if (previous && previous !== token) await source.deleteDevice(previous).catch(() => undefined);
  store.set(TOKEN, token);
  store.set(SEEN, today());
}

/** Must be called from a click: browsers only show the permission prompt on a user action. */
export async function enablePush(source: DataSource): Promise<PushStatus> {
  const before = pushStatus(source);
  if (before !== "off" && before !== "on") return before;
  if ((await Notification.requestPermission()) !== "granted") return pushStatus(source);
  await sync(source, await fetchToken());
  return "on";
}

export async function disablePush(source: DataSource): Promise<void> {
  const token = store.get(TOKEN);
  if (!token) return;
  await source.deleteDevice(token);
  store.set(TOKEN, null);
  store.set(SEEN, null);
  try {
    const { deleteToken, getMessaging } = await import("firebase/messaging");
    await deleteToken(getMessaging(getApp()));
  } catch {
    // The stored token is gone, so the scanner no longer sends here.
  }
}

/** Once a day on load: pick up a rotated token and refresh lastSeenAt. */
export async function refreshPush(source: DataSource): Promise<void> {
  if (pushStatus(source) !== "on" || store.get(SEEN) === today()) return;
  await sync(source, await fetchToken());
}

/** Shows a notification locally, without the scanner, to check how it looks on this device. */
export async function testNotification(): Promise<void> {
  const registration = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  await registration.showNotification("JobFinder test", {
    body: "Notifications work in this browser. Job alerts will look like this.",
    icon: "/icon-192.png",
    tag: "test",
    data: { url: "/" },
  });
}
