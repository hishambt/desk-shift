import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./App.css";

interface DesktopInfo {
  index: number;
  name: string;
}

type Tab = "desktops" | "shortcuts";

// Alt+1..0 → desktop 1..10 (Alt+1 = 0 … Alt+9 = 8, Alt+0 = 9)
const SHORTCUTS: [string, string][] = (() => {
  const list: [string, string][] = [];
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  digits.forEach((d, i) => list.push([`Alt+${d}`, `Switch to desktop ${i + 1}`]));
  digits.forEach((d, i) => list.push([`Alt+Shift+${d}`, `Move active window to desktop ${i + 1}`]));
  list.push(["Alt+N", "New desktop"]);
  list.push(["Alt+W", "Close current desktop"]);
  return list;
})();

interface DesktopRowProps {
  desktop: DesktopInfo;
  isCurrent: boolean;
  editing: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSwitch: () => void;
  onMove: () => void;
  onRemove: () => void;
}

function DesktopRow({
  desktop,
  isCurrent,
  editing,
  draft,
  onDraft,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSwitch,
  onMove,
  onRemove,
}: DesktopRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: desktop.index,
  });

  return (
    <li
      ref={setNodeRef}
      className={isCurrent ? "current" : ""}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <span className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ⋮⋮
      </span>
      <span className="badge">{desktop.index + 1}</span>
      {editing ? (
        <input
          className="rename-input"
          autoFocus
          value={draft}
          onChange={(e) => onDraft(e.currentTarget.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
        />
      ) : (
        <span className="name" title="Double-click to rename" onDoubleClick={onStartRename}>
          {desktop.name}
        </span>
      )}
      {isCurrent && <span className="here">● active</span>}
      <div className="actions">
        <button onClick={onSwitch}>Switch</button>
        <button onClick={onMove}>Move</button>
        <button onClick={onStartRename}>Rename</button>
        <button onClick={onRemove}>Remove</button>
      </div>
    </li>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("desktops");
  const [view, setView] = useState<"main" | "settings">("main");
  const [desktops, setDesktops] = useState<DesktopInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
    const unlisten = listen("desktops-changed", () => refresh());

    // Autostart is ON by default on first run; respect the user's choice after.
    isEnabled()
      .then(async (enabled) => {
        if (!localStorage.getItem("autostart_initialized")) {
          try {
            await enable();
            setAutoStart(true);
          } catch {
            setAutoStart(enabled);
          }
          localStorage.setItem("autostart_initialized", "1");
        } else {
          setAutoStart(enabled);
        }
      })
      .catch(() => {});

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = active.id as number;
    const to = over.id as number;

    setDesktops((items) => {
      const oldIndex = items.findIndex((d) => d.index === from);
      const newIndex = items.findIndex((d) => d.index === to);
      return arrayMove(items, oldIndex, newIndex);
    });

    invoke("reorder_desktop", { index: from, position: to })
      .then(() => refresh())
      .catch((e) => {
        setError(String(e));
        refresh();
      });
  }

  async function toggleAutoStart() {
    const next = !autoStart;
    try {
      if (next) await enable();
      else await disable();
      setAutoStart(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="container">
      <header className="header">
        <div>
          <h1>DeskShift</h1>
          <p className="tagline">Keyboard-first virtual desktop manager for Windows</p>
        </div>
        <button className="gear-btn" onClick={() => setView("settings")} title="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      {view === "settings" ? (
        <section>
          <div className="settings-header">
            <button className="back-btn" onClick={() => setView("main")} title="Back">
              ←
            </button>
            <h2>Settings</h2>
          </div>
          <label className="setting">
            <div>
              <div className="setting-title">Start on Windows startup</div>
              <div className="setting-desc">Launch DeskShift automatically when you sign in.</div>
            </div>
            <input type="checkbox" checked={autoStart} onChange={toggleAutoStart} />
          </label>
        </section>
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === "desktops" ? "active" : ""} onClick={() => setTab("desktops")}>
              Desktops
            </button>
            <button className={tab === "shortcuts" ? "active" : ""} onClick={() => setTab("shortcuts")}>
              Shortcuts
            </button>
          </nav>

          {tab === "desktops" && (
            <section>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={desktops.map((d) => d.index)} strategy={verticalListSortingStrategy}>
                  <ul className="desktops">
                    {desktops.map((d) => (
                      <DesktopRow
                        key={d.index}
                        desktop={d}
                        isCurrent={d.index === current}
                        editing={editing === d.index}
                        draft={draft}
                        onDraft={(v) => setDraft(v)}
                        onStartRename={() => startRename(d)}
                        onCommitRename={() => commitRename(d.index)}
                        onCancelRename={() => setEditing(null)}
                        onSwitch={() => run(() => invoke("switch_desktop", { index: d.index }))}
                        onMove={() => run(() => invoke("move_active_window", { index: d.index }))}
                        onRemove={() => run(() => invoke("remove_desktop", { index: d.index }))}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              <button className="new" onClick={() => run(() => invoke("create_desktop"))}>
                + New desktop
              </button>
            </section>
          )}

          {tab === "shortcuts" && (
            <section>
              <ul className="hotkeys">
                {SHORTCUTS.map(([keys, desc]) => (
                  <li key={keys}>
                    <code>{keys}</code>
                    <span>{desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

export default App;
