// The service worker (/sw.js): turns a push from the relay, which carries only a sid, into "New questions in <name>",
// unless that session's page is already in view. Tapping it opens the session.
import { load } from "./storage";

// The parts of the service worker scope used here; tsconfig has the DOM lib, not the webworker one.
type Page = { url: string; visibilityState: DocumentVisibilityState; focus(): Promise<unknown> };
type Waitable = Event & { waitUntil(task: Promise<unknown>): void };
type Worker = {
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<Page[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", listener: (event: Waitable & { data: { text(): string } | null }) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: Waitable & { notification: Notification }) => void,
  ): void;
};
const worker = self as unknown as Worker;

const pagesOf = async (sid: string) =>
  (await worker.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(
    (page) => new URL(page.url).pathname === `/a/${sid}`,
  );

function readSid(text = "") {
  try {
    const { sid } = JSON.parse(text);
    return typeof sid === "string" && /^[\w-]{22}$/.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

// ponytail: an agent's `say` update also counts as "new questions"; the relay can't tell them apart.
async function notify(sid: string | null) {
  if (!sid) return;
  if ((await pagesOf(sid)).some((page) => page.visibilityState === "visible")) return;
  const state = await load(sid);
  if (!state) return; // this browser no longer has the session
  await worker.registration.showNotification(state.name ? `New questions in ${state.name}` : "New questions", {
    tag: sid,
    data: sid,
    icon: "/apple-touch-icon.png",
  });
}

worker.addEventListener("push", (event) => event.waitUntil(notify(readSid(event.data?.text()))));

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const sid: string = event.notification.data;
  event.waitUntil(pagesOf(sid).then(([page]) => (page ? page.focus() : worker.clients.openWindow(`/a/${sid}`))));
});
