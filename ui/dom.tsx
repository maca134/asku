// DOM helpers, icons and the markdown sanitiser, shared by every page.
import DOMPurify from "dompurify";
import { marked } from "marked";

export { type Child, h } from "./jsx-runtime";

export const app = document.getElementById("app")!;
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const capitalise = (text: string) => text[0].toUpperCase() + text.slice(1);

// `code` spans in plain strings become <code>.
export const codeSpans = (text: string) =>
  text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code>{part}</code> : part));

// inline SVG, stroked with currentColor (no style attributes, so the CSP is happy)
const ICONS: Record<string, string> = {
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M13.5 9.5l2 2"/>',
  server:
    '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5v.01M7.5 16.5v.01"/>',
  message: '<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9.5L5 20.5v-14A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5z"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  minus: '<path d="M5.5 12h13"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  json: '<path d="M8.5 4.5H7.5a2 2 0 0 0-2 2v3a2.5 2.5 0 0 1-2 2.5 2.5 2.5 0 0 1 2 2.5v3a2 2 0 0 0 2 2h1M15.5 4.5h1a2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 2 2.5 2.5 2.5 0 0 0-2 2.5v3a2 2 0 0 1-2 2h-1"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h4"/>',
  bubble:
    '<path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6l-4 3.5V16a3 3 0 0 1-3-3z"/><path d="M10 8.7a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 13.6v.01"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.5 8.5v.01M15.5 8.5v.01M12 12v.01M8.5 15.5v.01M15.5 15.5v.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  github:
    '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
};

export function icon(name: string, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const github = name === "github";
  svg.setAttribute("viewBox", github ? "0 0 16 16" : "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon ${github ? "icon-fill" : ""} ${className}`);
  svg.innerHTML = ICONS[name];
  return svg;
}

// › asku▊
export function logo(href?: string) {
  const parts = [
    <span className="logo-prompt" ariaHidden="true">
      ›
    </span>,
    <span className="wordmark">asku</span>,
    <i className="logo-caret" ariaHidden="true" />,
  ];
  return href ? (
    <a className="logo" href={href} ariaLabel="asku home">
      {parts}
    </a>
  ) : (
    <span className="logo">{parts}</span>
  );
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
// markdown can't draw controls of its own, so the agent's text can't pose as a field of the form
// nor borrow the app's classes, ids and roles to look like one
const NO_CONTROLS = {
  FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option"],
  FORBID_ATTR: ["class", "id", "role", "tabindex", "for", "name", "style"],
  ALLOW_ARIA_ATTR: false,
};

export function markdown(source: string, className = "") {
  const div = <div className={`md ${className}`} />;
  div.innerHTML = DOMPurify.sanitize(marked.parse(source, { async: false }) as string, NO_CONTROLS);
  return div;
}
