import { useState, useRef } from "react";
import Popover from "./Popover";
import { ListPlus, Plus, ListMusic } from "lucide-react";
import type { Track } from "../types";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useToastStore } from "../store/useToastStore";
import { useT } from "../lib/i18n";

// Şarkıyı bir çalma listesine ekleyen küçük açılır menü.
export default function AddToPlaylistButton({
  track,
  always,
  openUp,
}: {
  track: Track;
  always?: boolean;
  openUp?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const playlists = usePlaylistStore((s) => s.playlists);
  const addTrack = usePlaylistStore((s) => s.addTrack);
  const create = usePlaylistStore((s) => s.create);
  const toast = useToastStore((s) => s.show);

  async function addTo(playlistId: string) {
    await addTrack(playlistId, track);
    setOpen(false);
    const pl = playlists.find((p) => p.id === playlistId);
    toast(t("toast.addedToPlaylist", { name: pl?.name ?? "" }), "info");
  }
  async function createAndAdd() {
    const name = t("library.newList");
    const p = await create(name);
    if (p) {
      await addTrack(p.id, track);
      toast(t("toast.playlistCreated", { name }), "info");
    }
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={t("addTo.title")}
        className={`grid h-7 w-7 place-items-center transition-colors hover:text-text ${
          open
            ? "text-text"
            : always
            ? "text-muted"
            : "text-faint opacity-0 group-hover:opacity-100"
        }`}
      >
        <ListPlus size={16} />
      </button>

      <Popover
        anchor={ref}
        open={open}
        onClose={() => setOpen(false)}
        placement={openUp ? "up" : "down"}
        width={232}
      >
          <button
            onClick={createAndAdd}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-text hover:bg-surface-3"
          >
            <Plus size={15} className="text-accent" />
            {t("addTo.newList")}
          </button>

          {playlists.length > 0 && <div className="my-1 h-px bg-border" />}

          <div className="max-h-64 overflow-y-auto">
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
      </Popover>
    </div>
  );
}
