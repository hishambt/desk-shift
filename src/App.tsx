import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface DesktopInfo {
  index: number;
  name: string;
}

const HOTKEYS: [string, string][] = [
  ["Alt+1 … Alt+0", "Switch to desktop 1–10"],
  ["Alt+Shift+1 … Alt+Shift+0", "Move active window to desktop 1–10"],
  ["Alt+N", "New desktop"],
  ["Alt+W", "Close current desktop"],
];

function App() {
  const [desktops, setDesktops] = useState<DesktopInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="container">
      <header>
        <h1>DeskShift</h1>
        <p className="tagline">less mouse, more keyboard</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section>
        <h2>Desktops</h2>
        <ul className="desktops">
          {desktops.map((d) => (
            <li key={d.index} className={d.index === current ? "current" : ""}>
              <span className="badge">{d.index + 1}</span>
              <span className="name">{d.name}</span>
              {d.index === current && <span className="here">● active</span>}
              <div className="actions">
                <button onClick={() => run(() => invoke("switch_desktop", { index: d.index }))}>
                  Switch
                </button>
                <button onClick={() => run(() => invoke("move_active_window", { index: d.index }))}>
                  Move window
                </button>
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

      <section>
        <h2>Hotkeys</h2>
        <ul className="hotkeys">
          {HOTKEYS.map(([keys, desc]) => (
            <li key={keys}>
              <code>{keys}</code>
              <span>{desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default App;
