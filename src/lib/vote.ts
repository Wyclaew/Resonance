import { usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";
import { ensureTrack, getTrackKarma, voteTrack, undoVote } from "./playlists";
import { t } from "./i18n";

// ═══════════════════════════════════════════════════════════════════════════
// ÇALAN ŞARKIYA OY — tek yer.
//
// Alt bar da mini oynatıcı da buradan geçer; iki ayrı kopya olsaydı biri
// `ensureTrack`'i unuttuğunda oy SESSİZCE sayılmamaya devam ederdi
// (CLAUDE.md gotcha #13: recommender oyları `votes ⨝ tracks` INNER JOIN ile
// okur, parça `tracks`'te yoksa oy yok sayılır).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Karma değişti — alt bardaki gösterge kendini tazelesin.
 *
 * ⚠️ Mini oynatıcıdan oy verildiğinde alt bar ESKİ sayıyı gösteriyordu:
 * NowPlayingBar karmayı kendi yerel state'inde tutuyor ve yalnız parça
 * değişince yeniliyor. Olayı burada yayınlayıp orada dinlemek, iki oy yolunu
 * (alt bar / mini) tek noktadan senkron tutar.
 */
export const KARMA_EVENT = "resonance:karma";

export interface KarmaEventDetail {
  playlistId: string;
  trackId: string;
  karma: number;
  lastVoteAt?: number;
}

function announceKarma(d: KarmaEventDetail): void {
  window.dispatchEvent(new CustomEvent<KarmaEventDetail>(KARMA_EVENT, { detail: d }));
}

export type VoteResult =
  | { ok: true; karma: number; lastVoteAt?: number }
  | { ok: false };

/**
 * Çalan şarkıya oy verir; cooldown/undo toast'larını da o gösterir.
 * `onKarma` verilirse hem oydan hem "geri al"dan sonra güncel karma ile çağrılır
 * (alt bardaki göstergenin geri almadan sonra da doğru kalması için).
 */
export async function voteCurrent(
  dir: 1 | -1,
  onKarma?: (k: { karma: number; lastVoteAt?: number }) => void
): Promise<VoteResult> {
  const current = usePlayerStore.getState().current;
  const playlistId = current?.playlistId;
  const showToast = useToastStore.getState().show;
  if (!playlistId || !current?.id) return { ok: false };
  try {
    await ensureTrack({
      id: current.id,
      source: current.source,
      sourceId: current.sourceId,
      title: current.title,
      artist: current.artist,
      album: current.album,
      durationMs: current.durationMs,
      thumbnail: current.thumbnail,
    });
    const res = await voteTrack(playlistId, current.id, dir);
    if (!res.ok) {
      const mins = Math.ceil(res.cooldownRemainingMs / 60_000);
      showToast(t("player.voteCooldown", { mins }), "info");
      return { ok: false };
    }
    const k = await getTrackKarma(playlistId, current.id);
    onKarma?.({ karma: k.karma, lastVoteAt: k.lastVoteAt });
    announceKarma({
      playlistId,
      trackId: current.id,
      karma: k.karma,
      lastVoteAt: k.lastVoteAt,
    });
    const pid = playlistId;
    const tid = current.id;
    showToast(dir > 0 ? t("player.liked") : t("player.disliked"), "info", {
      label: t("player.undo"),
      fn: async () => {
        await undoVote(pid, tid);
        const k2 = await getTrackKarma(pid, tid);
        onKarma?.({ karma: k2.karma, lastVoteAt: k2.lastVoteAt });
        announceKarma({
          playlistId: pid,
          trackId: tid,
          karma: k2.karma,
          lastVoteAt: k2.lastVoteAt,
        });
      },
    });
    return { ok: true, karma: k.karma, lastVoteAt: k.lastVoteAt };
  } catch {
    return { ok: false };
  }
}
