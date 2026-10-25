// The site's pages (home, how, security, demo, install, start, sessions, terms), swapped without a reload.
import { app, type Child, icon, logo } from "../dom";
import { PAGES } from "./pages";
import {
  controls,
  demos,
  faq,
  gallery,
  hero,
  homeHow,
  homeSecurity,
  how,
  installation,
  missing,
  security,
  sessions,
  start,
  terms,
} from "./sections";

const SECTIONS: Record<string, () => Child[]> = {
  "/": () => [hero(), homeHow(), controls(), homeSecurity()],
  "/how": () => [how(), faq()],
  "/security": () => [security()],
  "/demo": () => [demos(), gallery()],
  "/install": () => [installation()],
  "/start": () => [start()],
  "/sessions": () => [sessions()],
  "/terms": () => [terms()],
};

const GITHUB = "https://github.com/maca134/asku";

function header(path: string) {
  const links = Object.entries(PAGES).filter(([href]) => href !== "/" && href !== "/terms");
  return (
    <header className="site-header">
      <div className="wrap bar">
        {logo("/")}
        <nav className="nav" ariaLabel="Main">
          {links.map(([href, page]) => (
            <a href={href} ariaCurrent={href === path ? "page" : null}>
              {page.nav}
            </a>
          ))}
          <a href={GITHUB} className="nav-gh" ariaLabel="asku on GitHub">
            {icon("github")}
          </a>
        </nav>
      </div>
    </header>
  );
}

const footer = () => (
  <footer className="site-footer">
    <div className="wrap foot">
      <div className="foot-brand">
        {logo("/")}
        <span>Encrypted questions from AI agents to you.</span>
      </div>
      <nav className="foot-links" ariaLabel="Footer">
        <a href={GITHUB}>
          {icon("github")}
          GitHub
        </a>
        <a href="/skill.md">SKILL.md</a>
        <a href="/schema.json">schema.json</a>
        <a href={`${GITHUB}/blob/main/LICENSE`}>MIT License</a>
        <a href="/terms">Terms</a>
      </nav>
    </div>
  </footer>
);

export function landing() {
  const path = location.pathname;
  document.title = PAGES[path]?.title ?? "Not found · asku";
  const sections = SECTIONS[path]?.() ?? [missing()];
  app.replaceChildren(header(path), <main className="landing">{sections}</main>, footer());
}

// Links between the site's pages swap the page without a reload.
document.addEventListener("click", (event) => {
  const link = (event.target as Element).closest?.("a");
  const modified = event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (!link || !document.querySelector(".landing") || modified) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !(url.pathname in SECTIONS)) return;
  event.preventDefault();
  if (url.pathname !== location.pathname) history.pushState(null, "", url.pathname);
  landing();
  scrollTo(0, 0);
});

addEventListener("popstate", () => {
  if (document.querySelector(".landing")) landing();
});
