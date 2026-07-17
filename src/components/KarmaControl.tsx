import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { ArrowBigUp, ArrowBigDown } from "lucide-react";
import { displayKarma, cooldownRemaining } from "../lib/karma";

interface Props {
  karma: number;
  lastVoteAt?: number;
  onVote: (dir: 1 | -1) => void;
}

// Biriken karma oylaması: her up +1, down -1. Şarkı başına saatte 1 (cooldown).
export default function KarmaControl({ karma, lastVoteAt, onVote }: Props) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const remaining = cooldownRemaining(lastVoteAt, now);
  const onCooldown = remaining > 0;

  // Cooldown sürerken geri sayımı tazele.
  useEffect(() => {
    if (!onCooldown) return;
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, [onCooldown]);

  const display = displayKarma(karma);
  const color =
    display > 0 ? "text-up" : display < 0 ? "text-down" : "text-muted";
  const mins = Math.ceil(remaining / 60_000);
  const tip = onCooldown
    ? t("karma.cooldown", { mins })
    : t("karma.voteHere");

  function vote(dir: 1 | -1, e: React.MouseEvent) {
    e.stopPropagation();
    if (!onCooldown) onVote(dir);
  }

  return (
    <div
      className="flex items-center gap-0.5"
      title={tip}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => vote(1, e)}
        disabled={onCooldown}
        className={`grid h-7 w-6 place-items-center rounded transition-colors ${
          onCooldown
            ? "cursor-default text-faint/40"
            : "text-faint hover:bg-surface-3 hover:text-up"
        }`}
      >
        <ArrowBigUp size={17} />
      </button>
      <span className={`tnum w-7 text-center text-xs font-medium ${color}`}>
        {display}
      </span>
      <button
        onClick={(e) => vote(-1, e)}
        disabled={onCooldown}
        className={`grid h-7 w-6 place-items-center rounded transition-colors ${
          onCooldown
            ? "cursor-default text-faint/40"
            : "text-faint hover:bg-surface-3 hover:text-down"
        }`}
      >
        <ArrowBigDown size={17} />
      </button>
    </div>
  );
}
