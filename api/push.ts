// Web Push through the web-push package: VAPID-signed (RFC 8292), aes128gcm-encrypted (RFC 8291).
// `bun api/push.ts` prints a new VAPID key pair for ASKU_VAPID_PUBLIC / ASKU_VAPID_PRIVATE.
import webpush from "web-push";

export type Vapid = { publicKey: string; privateKey: string; subject: string };
export type Subscription = { endpoint: string; p256dh: string; auth: string };

// The push service's status code; web-push throws on anything but 2xx.
export async function sendPush(vapid: Vapid, { endpoint, p256dh, auth }: Subscription, payload: string) {
  try {
    const sent = await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload, {
      vapidDetails: vapid,
      TTL: 86400,
      urgency: "high",
    });
    return sent.statusCode;
  } catch (error) {
    if (error instanceof webpush.WebPushError) return error.statusCode;
    throw error;
  }
}

if (import.meta.main) {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  console.log(`ASKU_VAPID_PUBLIC=${publicKey}\nASKU_VAPID_PRIVATE=${privateKey}`);
}
