// Every session this browser holds, read from IndexedDB only: listing them tells the relay nothing.
import { icon } from "../dom";
import { drop, list, type Summary } from "./storage";

export function sessionList() {
  const rows = <ul className="sessions" ariaLabel="Sessions in this browser" />;
  const empty = (
    <p className="sessions-empty" hidden>
      No sessions in this browser. <a href="/start">Start one</a>, or open a link from your agent.
    </p>
  );
  const update = () => {
    empty.hidden = rows.childElementCount > 0;
  };
  list().then((sessions) => {
    rows.replaceChildren(...sessions.map((session) => row(session, update)));
    update();
  });
  return [rows, empty];
}

function statusOf({ joined, waiting }: Summary) {
  if (!joined) return "Waiting for your agent to join";
  return waiting ? "A form is waiting for you" : "No unanswered form";
}

function row(session: Summary, update: () => void) {
  const actions = <div className="session-actions" />;
  const item = (
    <li className={`card session ${session.waiting ? "waiting" : ""}`}>
      <a className="session-link" href={`/a/${session.sid}`}>
        <b>{session.name}</b>
        <span className="session-status">
          {session.waiting && icon("bell")}
          {statusOf(session)}
        </span>
        {session.active > 0 && (
          <time dateTime={new Date(session.active).toISOString()}>
            Last active {new Date(session.active).toLocaleString()}
          </time>
        )}
      </a>
      {actions}
    </li>
  );

  const idle = () => {
    const forget = (
      <button type="button" className="btn btn-secondary btn-sm">
        Forget
      </button>
    );
    forget.onclick = confirming;
    actions.replaceChildren(forget);
  };
  const confirming = () => {
    const yes = (
      <button type="button" className="btn btn-primary btn-sm">
        Forget it
      </button>
    );
    const no = (
      <button type="button" className="btn btn-secondary btn-sm">
        Cancel
      </button>
    );
    yes.onclick = async () => {
      await drop(session.sid);
      item.remove();
      update();
    };
    no.onclick = idle;
    actions.replaceChildren(
      <p role="alert">
        Forget this session? Its keys are deleted from this browser and it can't be opened here again.
      </p>,
      yes,
      no,
    );
    no.focus();
  };
  idle();
  return item;
}
