import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

const HOTKEYS: [string, string][] = [
  ["Alt+1 … Alt+0", "Switch to desktop 1–10"],
  ["Alt+Shift+1 … Alt+Shift+0", "Move active window to desktop 1–10 (and follow)"],
  ["Alt+N", "New desktop"],
  ["Alt+W", "Close current desktop"],
];

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
  const [desktops, setDesktops] = useState<DesktopInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = active.id as number;
    const to = over.id as number;

    // Optimistic local reorder for a smooth visual.
    setDesktops((items) => {
      const oldIndex = items.findIndex((d) => d.index === from);
      const newIndex = items.findIndex((d) => d.index === to);
      return arrayMove(items, oldIndex, newIndex);
    });

    // Persist; refresh reconciles (and reverts the optimistic move on error).
    invoke("reorder_desktop", { index: from, position: to })
      .then(() => refresh())
      .catch((e) => {
        setError(String(e));
        refresh();
      });
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
