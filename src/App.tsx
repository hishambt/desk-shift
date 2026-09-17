import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface DesktopInfo {
  index: number;
  name: string;
}

type Tab = "desktops" | "shortcuts";

const HOTKEYS: [string, string][] = [
  ["Alt+1 … Alt+0", "Switch to desktop 1–10"],
  ["Alt+Shift+1 … Alt+Shift+0", "Move active window to desktop 1–10 (and follow)"],
  ["Alt+N", "New desktop"],
  ["Alt+W", "Close current desktop"],
];

function App() {
  const [tab, setTab] = useState<Tab>("desktops");
  const [desktops, setDesktops] = useState<DesktopInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  async function refresh() {
    try {
      const [list, cur] = await Promise.all([
        invoke<DesktopInfo[]>("list_desktops"),
        invoke<number>("current_desktop"),
      ]);
      setDesktops(list);
      setCurrent(cur);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
    // Stay in sync with changes made anywhere (hotkeys, Windows Task View, …).
    const unlisten = listen("desktops-changed", () => refresh());
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function startRename(d: DesktopInfo) {
    setEditing(d.index);
    setDraft(d.name);
  }

  async function commitRename(index: number) {
    const name = draft.trim();
    setEditing(null);
    if (!name) return;
    await run(() => invoke("rename_desktop", { index, name }));
  }

  return (
    <main className="container">
      <header>
        <h1>DeskShift</h1>
        <p className="tagline">less mouse, more keyboard</p>
      </header>

      <nav className="tabs">
        <button className={tab === "desktops" ? "active" : ""} onClick={() => setTab("desktops")}>
          Desktops
        </button>
        <button className={tab === "shortcuts" ? "active" : ""} onClick={() => setTab("shortcuts")}>
          Shortcuts
        </button>
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === "desktops" && (
        <section>
          <ul className="desktops">
            {desktops.map((d) => (
              <li key={d.index} className={d.index === current ? "current" : ""}>
                <span className="badge">{d.index + 1}</span>
                {editing === d.index ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onBlur={() => commitRename(d.index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(d.index);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span className="name" title="Double-click to rename" onDoubleClick={() => startRename(d)}>
                    {d.name}
                  </span>
                )}
                {d.index === current && <span className="here">● active</span>}
                <div className="actions">
                  <button onClick={() => run(() => invoke("switch_desktop", { index: d.index }))}>
                    Switch
                  </button>
                  <button onClick={() => run(() => invoke("move_active_window", { index: d.index }))}>
                    Move
                  </button>
                  <button onClick={() => startRename(d)}>Rename</button>
                  <button onClick={() => run(() => invoke("remove_desktop", { index: d.index }))}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="new" onClick={() => run(() => invoke("create_desktop"))}>
            + New desktop
          </button>
        </section>
      )}

      {tab === "shortcuts" && (
        <section>
          <ul className="hotkeys">
            {HOTKEYS.map(([keys, desc]) => (
              <li key={keys}>
                <code>{keys}</code>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;
