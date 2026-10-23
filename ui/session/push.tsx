// The phone button in the top bar: a notification on this device when the agent asks something, per session.
// Nothing is asked until the user taps it.
import { h, icon } from "../dom";
import { addToFeed, feedEvent, pushSlot } from "../page";
import type { Session } from "./send";
import { save } from "./storage";

const fromBase64url = (text: string) => Uint8Array.fromBase64(text, { alphabet: "base64url" });

export async function offerPush({ sid, state }: Session) {
  if (!("PushManager" in window) || !navigator.serviceWorker) return;
  const info = await fetch(`/s/${sid}`)
    .then((res) => res.json())
    .catch(() => ({}));
  if (typeof info.push !== "string") return; // the relay has no VAPID keys
  const serverKey: string = info.push;

  const button = h("button", { type: "button", className: "bell push", ariaLabel: "Notify me of new questions" });
  button.append(icon("phone"));
  const update = () => {
    button.ariaPressed = String(!!state.push);
    button.title = state.push
      ? "Notifies this device of new questions (tap to stop)"
      : "Tap to get a notification on this device when the agent asks something";
  };
  button.onclick = async () => {
    button.disabled = true;
    try {
      await relay(sid, state.key, state.push ? null : await subscribe(serverKey));
      state.push = !state.push;
      await save(sid, state);
    } catch (error) {
      addToFeed(feedEvent("alert", `Notifications: ${(error as Error).message}`));
    }
    button.disabled = false;
    update();
  };
  update();
  pushSlot.replaceChildren(button);
}

async function subscribe(serverKey: string) {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("they are blocked for this site.");
  await navigator.serviceWorker.register("/sw.js");
  const { pushManager } = await navigator.serviceWorker.ready;
  const applicationServerKey = fromBase64url(serverKey);
  const existing = await pushManager.getSubscription();
  const existingKey = existing?.options.applicationServerKey;
  if (existing && existingKey && new Uint8Array(existingKey).toBase64() === applicationServerKey.toBase64())
    return existing;
  await existing?.unsubscribe(); // made for the relay's old keys
  return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

// One browser subscription serves every session; turning one off only tells the relay to stop for that session.
async function relay(sid: string, key: string, subscription: PushSubscription | null) {
  const res = await fetch(`/s/${sid}/push`, {
    method: subscription ? "PUT" : "DELETE",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: subscription && JSON.stringify(subscription),
  });
  if (!res.ok) throw new Error(`the relay said ${res.status}.`);
}
