import { ArrowBigUp, ArrowBigDown } from "lucide-react";
import { displayKarma } from "../lib/karma";
import type { Vote } from "../types";

interface Props {
  vote: Vote;
  karma: number;
  onVote: (dir: 1 | -1) => void;
}

// Çalma listesi içinde şarkı başına Reddit tarzı karma oylaması.
export default function KarmaControl({ vote, karma, onVote }: Props) {
  const display = displayKarma(karma);
  const color =
    display > 0 ? "text-up" : display < 0 ? "text-down" : "text-muted";

  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote(1);
        }}
        title="Upvote"
        className={`grid h-7 w-6 place-items-center rounded transition-colors hover:bg-surface-3 ${
          vote === 1 ? "text-up" : "text-faint hover:text-up"
        }`}
      >
        <ArrowBigUp size={17} fill={vote === 1 ? "currentColor" : "none"} />
      </button>
      <span className={`tnum w-6 text-center text-xs font-medium ${color}`}>
        {display}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote(-1);
        }}
        title="Downvote"
        className={`grid h-7 w-6 place-items-center rounded transition-colors hover:bg-surface-3 ${
          vote === -1 ? "text-down" : "text-faint hover:text-down"
        }`}
      >
        <ArrowBigDown size={17} fill={vote === -1 ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
