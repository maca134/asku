// The service worker (/sw.js): turns a push from the relay, which carries only a sid and seq, into "New questions in
// <name>", unless that session's page is already in view. Tapping it opens the session. A batch that is one yes/no
// question gets Yes/No buttons, which answer it from here as the page would.
import { deriveKeys } from "../../shared/crypto";
import { choice, confirmAnswer, fetchBatch, quickConfirm } from "./quick";
import { sendAnswer } from "./send";
import { load, type State } from "./storage";

// The parts of the service worker scope used here; tsconfig has the DOM lib, not the webworker one.
type Page = {
  url: string;
  visibilityState: DocumentVisibilityState;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
};
type Waitable = Event & { waitUntil(task: Promise<unknown>): void };
type Worker = {
  registration: ServiceWorkerRegistration;
  location: Location;
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<Page[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", listener: (event: Waitable & { data: { text(): string } | null }) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: Waitable & { notification: Notification; action: string }) => void,
  ): void;
};
type Pushed = { sid: string; seq: number };
type Quick = Pushed & { id: string };
const worker = self as unknown as Worker;

const pagesOf = async (sid: string) =>
  (await worker.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(
    (page) => new URL(page.url).pathname === `/a/${sid}`,
  );

function readPush(text = ""): Pushed | null {
  try {
    const { sid, seq } = JSON.parse(text);
    if (typeof sid !== "string" || !/^[\w-]{22}$/.test(sid)) return null;
    return { sid, seq: Number.isSafeInteger(seq) && seq > 0 ? seq : 0 };
  } catch {
    return null;
  }
}

const keysOf = (priv: CryptoKey, agentPub: string) => deriveKeys(priv, Uint8Array.fromBase64(agentPub));

async function quickQuestion({ sid, seq }: Pushed, state: State) {
  if (!seq || !state.agentPub || state.answered.includes(seq)) return null;
  const keys = await keysOf(state.priv, state.agentPub);
  const batch = await fetchBatch(worker.location.origin, sid, seq, keys, AbortSignal.timeout(5000));
  return quickConfirm(batch);
}

async function notify(pushed: Pushed | null) {
  if (!pushed) return;
  const { sid, seq } = pushed;
  if ((await pagesOf(sid)).some((page) => page.visibilityState === "visible")) return;
  const state = await load(sid);
  const options = { tag: sid, icon: "/apple-touch-icon.png" };
  // userVisibleOnly: a push must show a notification, so a session this browser no longer has still gets a plain one
  const item = state && (await quickQuestion(pushed, state));
  const title = state?.name ? `New questions in ${state.name}` : "New questions";
  if (!item) return worker.registration.showNotification(title, { ...options, data: { sid } });
  const data: Quick = { sid, seq, id: item.id };
  // Platforms without notification actions (iOS) drop them: a tap then opens the page.
  await worker.registration.showNotification(title, {
    ...options,
    body: item.label,
    data,
    actions: [
      { action: "yes", title: "Yes" },
      { action: "no", title: "No" },
    ],
  } as NotificationOptions);
}

async function answer({ sid, seq, id }: Quick, yes: boolean) {
  const state = await load(sid);
  if (!state?.agentPub) throw new Error("session gone");
  await sendAnswer({ sid, keys: await keysOf(state.priv, state.agentPub), state }, [seq], confirmAnswer(seq, id, yes));
  for (const page of await pagesOf(sid)) page.postMessage({ sid, answered: seq });
}

const openPage = (sid: string) =>
  pagesOf(sid).then(([page]) => (page ? page.focus() : worker.clients.openWindow(`/a/${sid}`)));

worker.addEventListener("push", (event) => event.waitUntil(notify(readPush(event.data?.text()))));

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data: Pushed & Partial<Quick> = event.notification.data;
  const yes = choice(event.action);
  if (yes === null || !data.id) return event.waitUntil(openPage(data.sid));
  event.waitUntil(answer(data as Quick, yes).catch(() => openPage(data.sid)));
});
