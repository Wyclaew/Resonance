import { useState, useRef, useEffect } from "react";
import { ListPlus, Plus, ListMusic } from "lucide-react";
import type { Track } from "../types";
import { usePlaylistStore } from "../store/usePlaylistStore";

// Şarkıyı bir çalma listesine ekleyen küçük açılır menü.
export default function AddToPlaylistButton({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const playlists = usePlaylistStore((s) => s.playlists);
  const addTrack = usePlaylistStore((s) => s.addTrack);
  const create = usePlaylistStore((s) => s.create);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function addTo(playlistId: string) {
    await addTrack(playlistId, track);
    setOpen(false);
  }
  async function createAndAdd() {
    const p = await create("Yeni Liste");
    if (p) await addTrack(p.id, track);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Çalma listesine ekle"
        className={`grid h-7 w-7 place-items-center transition-colors hover:text-text ${
          open ? "text-text" : "text-faint opacity-0 group-hover:opacity-100"
        }`}
      >
        <ListPlus size={16} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-surface-2 p-1 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={createAndAdd}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-text hover:bg-surface-3"
          >
            <Plus size={15} className="text-accent" />
            Yeni liste oluştur
          </button>

          {playlists.length > 0 && <div className="my-1 h-px bg-border" />}

          <div className="max-h-56 overflow-y-auto">
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => addTo(p.id)}
                className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
              >
                <ListMusic size={14} className="shrink-0 text-faint" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
