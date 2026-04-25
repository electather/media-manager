import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Notebook,
  RefreshCwIcon,
  RotateCcwIcon,
  SparklesIcon,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

// ─── Mock data ────────────────────────────────────────────────────────────────

interface Genre {
  name: string;
  score: number;
  overridden?: boolean;
}

interface Theme {
  name: string;
  score: number;
  overridden?: boolean;
}

interface Person {
  name: string;
  score: number;
  via: string[];
}

interface FeedbackItem {
  id: string;
  type: "like" | "dislike" | "rating" | "note";
  value?: number;
  title: string;
  media: "Movie" | "TV";
  time: string;
  note?: string;
}

const INITIAL_GENRES: Genre[] = [
  { name: "Sci-Fi", score: 0.91 },
  { name: "Drama", score: 0.84, overridden: true },
  { name: "Thriller", score: 0.78 },
  { name: "Crime", score: 0.62 },
  { name: "A24 / Arthouse", score: 0.58 },
  { name: "Mystery", score: 0.41 },
  { name: "Horror", score: 0.28 },
  { name: "Animation", score: 0.22 },
  { name: "Documentary", score: 0.12 },
  { name: "Biography", score: 0.05 },
  { name: "Adventure", score: -0.02 },
  { name: "Fantasy", score: -0.08 },
  { name: "Comedy", score: -0.14 },
  { name: "Action", score: -0.21 },
  { name: "Family", score: -0.35 },
  { name: "War", score: -0.42 },
  { name: "Musical", score: -0.58 },
  { name: "Sport", score: -0.61 },
  { name: "Romance", score: -0.67, overridden: true },
  { name: "Western", score: -0.79 },
];

const INITIAL_THEMES: Theme[] = [
  { name: "twist-ending", score: 0.92 },
  { name: "unreliable narrator", score: 0.88 },
  { name: "slow-burn", score: 0.81 },
  { name: "atmospheric", score: 0.76 },
  { name: "anti-capitalist", score: 0.71 },
  { name: "cerebral", score: 0.66 },
  { name: "neo-noir", score: 0.61 },
  { name: "dystopian", score: 0.54 },
  { name: "character study", score: 0.49, overridden: true },
  { name: "existential", score: 0.46 },
  { name: "class critique", score: 0.38 },
  { name: "ensemble cast", score: 0.22 },
  { name: "found footage", score: 0.14 },
  { name: "vignettes", score: 0.08 },
  { name: "coming-of-age", score: -0.06 },
  { name: "time loop", score: -0.12 },
  { name: "rom-com", score: -0.45 },
  { name: "wholesome", score: -0.52 },
  { name: "cgi-heavy", score: -0.61 },
  { name: "jump scares", score: -0.74 },
  { name: "torture", score: -0.84 },
];

const DIRECTORS_POS: Person[] = [
  {
    name: "Denis Villeneuve",
    score: 0.94,
    via: ["Dune", "Arrival", "Blade Runner 2049"],
  },
  {
    name: "Jonathan Glazer",
    score: 0.88,
    via: ["The Zone of Interest", "Under the Skin"],
  },
  {
    name: "Christopher Nolan",
    score: 0.82,
    via: ["Oppenheimer", "Interstellar", "Memento"],
  },
  {
    name: "Park Chan-wook",
    score: 0.79,
    via: ["Decision to Leave", "The Handmaiden"],
  },
  {
    name: "Yorgos Lanthimos",
    score: 0.71,
    via: ["Poor Things", "The Favourite"],
  },
  {
    name: "Bong Joon-ho",
    score: 0.68,
    via: ["Parasite", "Memories of Murder"],
  },
  { name: "Wim Wenders", score: 0.52, via: ["Perfect Days"] },
];

const DIRECTORS_NEG: Person[] = [
  { name: "Michael Bay", score: -0.72, via: ["Transformers", "6 Underground"] },
  { name: "Zack Snyder", score: -0.48, via: ["Army of the Dead"] },
];

const ACTORS_POS: Person[] = [
  {
    name: "Cillian Murphy",
    score: 0.91,
    via: ["Oppenheimer", "Peaky Blinders"],
  },
  { name: "Florence Pugh", score: 0.82, via: ["Oppenheimer", "Midsommar"] },
  { name: "Adam Driver", score: 0.76, via: ["Marriage Story", "Paterson"] },
  { name: "Saoirse Ronan", score: 0.68, via: ["Lady Bird", "Little Women"] },
  {
    name: "Tilda Swinton",
    score: 0.62,
    via: ["The Zone of Interest", "Memoria"],
  },
  { name: "Brendan Gleeson", score: 0.55, via: ["The Banshees of Inisherin"] },
];

const ACTORS_NEG: Person[] = [{ name: "Dwayne Johnson", score: -0.51, via: ["Red Notice"] }];

const RATING_STATS = {
  mean: 6.8,
  std: 1.9,
  count: 142,
  distribution: [1, 1, 3, 6, 14, 22, 31, 38, 19, 7],
};

const INITIAL_FEEDBACK: FeedbackItem[] = [
  {
    id: "f1",
    type: "like",
    title: "The Zone of Interest",
    media: "Movie",
    time: "2h ago",
  },
  {
    id: "f2",
    type: "rating",
    value: 9,
    title: "Dune: Part Two",
    media: "Movie",
    time: "yesterday",
  },
  {
    id: "f3",
    type: "note",
    title: "Shōgun",
    media: "TV",
    time: "yesterday",
    note: "Pacing is slow in a way I love. Keep recommending stuff like this.",
  },
  {
    id: "f4",
    type: "dislike",
    title: "Red Notice",
    media: "Movie",
    time: "3 days ago",
  },
  {
    id: "f5",
    type: "like",
    title: "Past Lives",
    media: "Movie",
    time: "4 days ago",
  },
  {
    id: "f6",
    type: "rating",
    value: 8,
    title: "True Detective S4",
    media: "TV",
    time: "5 days ago",
  },
  {
    id: "f7",
    type: "note",
    title: "Perfect Days",
    media: "Movie",
    time: "1 week ago",
    note: "Quiet observation. More like this.",
  },
  {
    id: "f8",
    type: "dislike",
    title: "Madame Web",
    media: "Movie",
    time: "1 week ago",
  },
  {
    id: "f9",
    type: "rating",
    value: 7,
    title: "Slow Horses",
    media: "TV",
    time: "2 weeks ago",
  },
  {
    id: "f10",
    type: "like",
    title: "Decision to Leave",
    media: "Movie",
    time: "3 weeks ago",
  },
];

// ─── Bipolar slider ───────────────────────────────────────────────────────────

function BipolarSlider({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const valueFromEvent = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const v = Math.round((pct * 2 - 1) * 100) / 100;
      onChange(v);
    },
    [onChange],
  );

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    dragging.current = true;
    valueFromEvent(e.clientX);
    const onMove = (ev: globalThis.MouseEvent) => {
      if (dragging.current) valueFromEvent(ev.clientX);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onCommit?.();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    dragging.current = true;
    if (e.touches[0]) valueFromEvent(e.touches[0].clientX);
    const onMove = (ev: globalThis.TouchEvent) => {
      if (dragging.current && ev.touches[0]) valueFromEvent(ev.touches[0].clientX);
    };
    const onEnd = () => {
      dragging.current = false;
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      onCommit?.();
    };
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
  };

  const pct = ((value + 1) / 2) * 100;
  const isPos = value >= 0;
  const fillWidth = Math.abs(value) * 50;

  return (
    <div
      ref={trackRef}
      className="relative flex h-7 cursor-pointer select-none items-center"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      role="slider"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={value}
    >
      <div className="relative h-1 w-full rounded-full bg-muted">
        <div className="absolute inset-y-[-4px] left-1/2 w-px bg-border" />
        {isPos ? (
          <div
            className="absolute top-0 h-full rounded-full bg-foreground"
            style={{ left: "50%", width: `${fillWidth}%` }}
          />
        ) : (
          <div
            className="absolute top-0 h-full rounded-full bg-muted-foreground/60"
            style={{ right: "50%", width: `${fillWidth}%` }}
          />
        )}
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-foreground bg-background shadow-sm"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Genre section ────────────────────────────────────────────────────────────

function GenreRow({
  g,
  onChange,
  onReset,
  onCommit,
}: {
  g: Genre;
  onChange: (g: Genre, v: number) => void;
  onReset: (g: Genre) => void;
  onCommit: () => void;
}) {
  const neutral = Math.abs(g.score) < 0.1;
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-border py-3 last:border-0",
        "[grid-template-columns:130px_1fr_auto]",
        neutral && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {g.name}
        {g.overridden && (
          <span
            className="inline-block size-1.5 rounded-full bg-foreground"
            title="Manually adjusted"
          />
        )}
      </div>
      <BipolarSlider value={g.score} onChange={(v) => onChange(g, v)} onCommit={onCommit} />
      <div className="flex items-center gap-1.5">
        <span className="min-w-[36px] text-right font-mono text-xs text-muted-foreground">
          {g.score > 0 ? "+" : ""}
          {g.score.toFixed(2)}
        </span>
        {g.overridden && (
          <button
            className="flex size-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
            onClick={() => onReset(g)}
            title="Reset to computed"
          >
            <RotateCcwIcon className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function GenreSection({
  genres,
  onChange,
  onReset,
}: {
  genres: Genre[];
  onChange: (g: Genre, v: number) => void;
  onReset: (g: Genre) => void;
}) {
  const genresRef = useRef(genres);
  genresRef.current = genres;

  const [sortedNames, setSortedNames] = useState(() =>
    [...genres].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).map((g) => g.name),
  );

  const handleCommit = useCallback(() => {
    setSortedNames(
      [...genresRef.current]
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .map((g) => g.name),
    );
  }, []);

  const genreMap = new Map(genres.map((g) => [g.name, g]));
  const sorted = sortedNames.map((name) => genreMap.get(name)).filter(Boolean) as Genre[];
  const half = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, half);
  const right = sorted.slice(half);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Genre affinities</CardTitle>
        <p className="text-sm text-muted-foreground">
          Strongest opinions first. Drag any slider to override. Overridden values won't change on
          recomputation.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
          <div>
            {left.map((g) => (
              <GenreRow
                key={g.name}
                g={g}
                onChange={onChange}
                onReset={onReset}
                onCommit={handleCommit}
              />
            ))}
          </div>
          <div>
            {right.map((g) => (
              <GenreRow
                key={g.name}
                g={g}
                onChange={onChange}
                onReset={onReset}
                onCommit={handleCommit}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Theme tag cloud ──────────────────────────────────────────────────────────

function tagClass(score: number): string {
  if (score >= 0.7) return "text-[15px] font-semibold border-foreground";
  if (score >= 0.4) return "text-[13.5px] font-medium";
  if (score >= 0.1) return "text-[12.5px]";
  if (score <= -0.7)
    return "text-[13.5px] font-medium text-destructive border-destructive/50 bg-destructive/8";
  if (score <= -0.4) return "text-[13px] text-destructive border-destructive/30 bg-destructive/5";
  if (score <= -0.1)
    return "text-[12.5px] text-muted-foreground line-through decoration-destructive/50";
  return "text-xs text-muted-foreground";
}

function TagPopoverPanel({
  tag,
  onClose,
  onChange,
  onCommit,
  onReset,
  onRemove,
}: {
  tag: Theme;
  onClose: () => void;
  onChange: (t: Theme, v: number) => void;
  onCommit: () => void;
  onReset: (t: Theme) => void;
  onRemove: (t: Theme) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-30 min-w-[280px] max-w-[340px] rounded-xl border border-border bg-popover p-4 shadow-lg"
      style={{ top: 8, left: 8, right: 8 }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold">{tag.name}</h4>
        <span className="font-mono text-xs text-muted-foreground">
          {tag.score > 0 ? "+" : ""}
          {tag.score.toFixed(2)}
        </span>
      </div>
      <BipolarSlider value={tag.score} onChange={(v) => onChange(tag, v)} onCommit={onCommit} />
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground leading-relaxed">
        Contributed by your rating of <strong className="text-foreground">Blade Runner 2049</strong>{" "}
        and a note on <strong className="text-foreground">Drive</strong>.
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => {
            if (tag.overridden) {
              onReset(tag);
            } else {
              onRemove(tag);
            }
            onClose();
          }}
        >
          {tag.overridden ? "Reset to computed" : "Remove keyword"}
        </button>
        <Button variant="outline" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ThemeSection({
  themes,
  onChange,
  onReset,
  onRemove,
}: {
  themes: Theme[];
  onChange: (t: Theme, v: number) => void;
  onReset: (t: Theme) => void;
  onRemove: (t: Theme) => void;
}) {
  const themesRef = useRef(themes);
  themesRef.current = themes;

  const [sortedNames, setSortedNames] = useState(() =>
    [...themes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).map((t) => t.name),
  );

  const handleCommit = useCallback(() => {
    setSortedNames(
      [...themesRef.current]
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .map((t) => t.name),
    );
  }, []);

  const handleRemove = useCallback(
    (t: Theme) => {
      onRemove(t);
      setSortedNames((names) => names.filter((n) => n !== t.name));
    },
    [onRemove],
  );

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const themeMap = new Map(themes.map((t) => [t.name, t]));
  const sorted = sortedNames.map((name) => themeMap.get(name)).filter(Boolean) as Theme[];
  const activeTheme = themes.find((t) => t.name === activeTag);

  return (
    <Card className="overflow-visible">
      <CardHeader>
        <CardTitle>Themes & keywords</CardTitle>
        <p className="text-sm text-muted-foreground">
          Tags the system has picked up from your ratings and notes. Click any tag to inspect or
          adjust.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          ref={containerRef}
          className="relative flex flex-wrap gap-2 rounded-lg border border-border bg-card p-5"
        >
          {sorted.map((t) => (
            <button
              key={t.name}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 font-sans transition-colors hover:bg-accent",
                tagClass(t.score),
              )}
              onClick={() => setActiveTag(activeTag === t.name ? null : t.name)}
            >
              {t.name}
              {t.overridden && (
                <span className="inline-block size-1 rounded-full bg-current opacity-60" />
              )}
            </button>
          ))}
          {activeTag && activeTheme && (
            <TagPopoverPanel
              tag={activeTheme}
              onClose={() => setActiveTag(null)}
              onChange={onChange}
              onCommit={handleCommit}
              onReset={onReset}
              onRemove={handleRemove}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── People section ───────────────────────────────────────────────────────────

function PersonRow({ p }: { p: Person }) {
  const barPct = Math.abs(p.score) * 50;
  const isPos = p.score >= 0;
  return (
    <div className="grid items-center gap-3 border-b border-border py-3 last:border-0 [grid-template-columns:1fr_100px_40px]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">via {p.via.join(", ")}</p>
      </div>
      <div className="relative h-1 rounded-full bg-muted">
        <div className="absolute inset-y-[-3px] left-1/2 w-px bg-border" />
        {isPos ? (
          <div
            className="absolute top-0 h-full rounded-full bg-foreground"
            style={{ left: "50%", width: `${barPct}%` }}
          />
        ) : (
          <div
            className="absolute top-0 h-full rounded-full bg-destructive"
            style={{ right: "50%", width: `${barPct}%` }}
          />
        )}
      </div>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {p.score > 0 ? "+" : ""}
        {p.score.toFixed(2)}
      </span>
    </div>
  );
}

function PeopleCard({
  title,
  hint,
  people,
  negative,
}: {
  title: string;
  hint: string;
  people: Person[];
  negative: Person[];
}) {
  const [showNeg, setShowNeg] = useState(false);
  return (
    <Card size="sm">
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {people.map((p) => (
          <PersonRow key={p.name} p={p} />
        ))}
        {negative.length > 0 && (
          <div className="mt-2">
            <button
              className="inline-flex items-center gap-1 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              onClick={() => setShowNeg((s) => !s)}
            >
              {showNeg ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronRightIcon className="size-3" />
              )}
              Not for me ({negative.length})
            </button>
            {showNeg && negative.map((p) => <PersonRow key={p.name} p={p} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Rating histogram ─────────────────────────────────────────────────────────

function RatingSection() {
  const { mean, std, count, distribution } = RATING_STATS;
  const max = Math.max(...distribution);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rating behavior</CardTitle>
        <p className="text-sm text-muted-foreground">
          How you rate relative to the full scale, so the engine can calibrate.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-5 grid grid-cols-3 gap-4 border-b border-border pb-5">
          <div>
            <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
              Your average
            </p>
            <p className="text-2xl font-semibold tracking-tight">
              {mean.toFixed(1)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ 10</span>
            </p>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
              Total rated
            </p>
            <p className="text-2xl font-semibold tracking-tight">
              {count}
              <span className="ml-1 text-sm font-normal text-muted-foreground">titles</span>
            </p>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
              Spread (σ)
            </p>
            <p className="text-2xl font-semibold tracking-tight">{std.toFixed(1)}</p>
          </div>
        </div>
        <div className="flex h-20 items-end gap-1.5">
          {distribution.map((n, i) => {
            const near = Math.abs(i + 1 - mean) < 1;
            return (
              <div
                key={i}
                className={cn(
                  "flex-1 min-h-[2px] rounded-t-sm",
                  near ? "bg-foreground" : "bg-muted-foreground/30",
                )}
                style={{ height: `${(n / max) * 100}%` }}
                title={`${i + 1}: ${n}`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex">
          {distribution.map((_, i) => (
            <div
              key={i}
              className="flex-1 text-center font-mono text-[10.5px] text-muted-foreground"
            >
              {i + 1}
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground leading-relaxed max-w-[55ch]">
          The system adjusts for your personal scale. A 7 from you means something different than a
          7 from someone who rates everything 8+.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Feedback history ─────────────────────────────────────────────────────────

const FB_FILTERS = [
  { id: "all", label: "All" },
  { id: "like", label: "Likes" },
  { id: "dislike", label: "Dislikes" },
  { id: "rating", label: "Ratings" },
  { id: "note", label: "Notes" },
] as const;

type FbFilter = (typeof FB_FILTERS)[number]["id"];

function FeedbackBadge({ item }: { item: FeedbackItem }) {
  if (item.type === "like")
    return (
      <Badge variant="outline">
        <ThumbsUp /> Liked
      </Badge>
    );
  if (item.type === "dislike")
    return (
      <Badge variant="outline">
        <ThumbsDown /> Disliked
      </Badge>
    );
  if (item.type === "rating")
    return (
      <Badge variant="outline">
        <Star />
        {item.value}/10
      </Badge>
    );
  return (
    <Badge variant="outline" className="font-mono text-xs">
      <Notebook /> Note
    </Badge>
  );
}

function FeedbackRow({
  item,
  onDelete,
}: {
  item: FeedbackItem;
  onDelete: (item: FeedbackItem) => void;
}) {
  return (
    <div className="grid items-center gap-3 border-b border-border py-3 last:border-0 [grid-template-columns:1fr_auto_auto_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{item.media}</span>
        </div>
        {item.note && (
          <p className="mt-1 text-xs italic text-muted-foreground leading-relaxed max-w-[52ch]">
            "{item.note}"
          </p>
        )}
      </div>
      <FeedbackBadge item={item} />
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{item.time}</span>
      <button
        className="flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/8 hover:text-destructive"
        onClick={() => onDelete(item)}
        aria-label="Delete feedback"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </div>
  );
}

function FeedbackSection({
  feedback,
  onDelete,
}: {
  feedback: FeedbackItem[];
  onDelete: (item: FeedbackItem) => void;
}) {
  const [filter, setFilter] = useState<FbFilter>("all");
  const [sort, setSort] = useState<"new" | "old">("new");

  const visible = feedback
    .filter((f) => filter === "all" || f.type === filter)
    .slice()
    .reverse()
    .slice(sort === "old" ? 0 : undefined)
    [sort === "old" ? "reverse" : "slice"]();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback history</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every signal that feeds the profile. Remove anything you want the engine to forget.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
            {FB_FILTERS.map((f) => (
              <button
                key={f.id}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "new" | "old")}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </label>
        </div>

        <div className="rounded-lg border border-border bg-card px-4">
          {visible.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No {filter === "all" ? "feedback" : filter + "s"} yet.
            </div>
          ) : (
            visible.map((item) => <FeedbackRow key={item.id} item={item} onDelete={onDelete} />)
          )}
        </div>

        {visible.length > 0 && (
          <div className="mt-1 flex items-center justify-between px-1 pt-3 text-xs text-muted-foreground">
            <span>
              Showing {visible.length} of {feedback.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Previous
              </Button>
              <Button variant="outline" size="sm">
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ProfilePage() {
  const [genres, setGenres] = useState<Genre[]>(INITIAL_GENRES);
  const [themes, setThemes] = useState<Theme[]>(INITIAL_THEMES);
  const [feedback, setFeedback] = useState<FeedbackItem[]>(INITIAL_FEEDBACK);

  const [confirmDel, setConfirmDel] = useState<FeedbackItem | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const overrideCount =
    genres.filter((g) => g.overridden).length + themes.filter((t) => t.overridden).length;

  const updateGenre = useCallback((g: Genre, v: number) => {
    setGenres((gs) =>
      gs.map((x) => (x.name === g.name ? { ...x, score: v, overridden: true } : x)),
    );
  }, []);

  const resetGenre = useCallback((g: Genre) => {
    setGenres((gs) => gs.map((x) => (x.name === g.name ? { ...x, overridden: false } : x)));
  }, []);

  const updateTheme = useCallback((t: Theme, v: number) => {
    setThemes((ts) =>
      ts.map((x) => (x.name === t.name ? { ...x, score: v, overridden: true } : x)),
    );
  }, []);

  const resetTheme = useCallback((t: Theme) => {
    setThemes((ts) => ts.map((x) => (x.name === t.name ? { ...x, overridden: false } : x)));
  }, []);

  const removeTheme = useCallback((t: Theme) => {
    setThemes((ts) => ts.filter((x) => x.name !== t.name));
  }, []);

  const deleteFeedback = (item: FeedbackItem) => {
    setFeedback((fs) => fs.filter((f) => f.id !== item.id));
    setConfirmDel(null);
  };

  const resetAllOverrides = () => {
    setGenres((gs) => gs.map((g) => ({ ...g, overridden: false })));
    setThemes((ts) => ts.map((t) => ({ ...t, overridden: false })));
    setConfirmReset(false);
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-6 pb-24 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Taste Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How the system understands your preferences. Adjust anything that feels off.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
            <RotateCcwIcon />
            Reset overrides{overrideCount > 0 ? ` (${overrideCount})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmRebuild(true)}>
            <RefreshCwIcon />
            Rebuild profile
          </Button>
        </div>
      </div>

      <GenreSection genres={genres} onChange={updateGenre} onReset={resetGenre} />

      <ThemeSection
        themes={themes}
        onChange={updateTheme}
        onReset={resetTheme}
        onRemove={removeTheme}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <PeopleCard
          title="Directors"
          hint={`Top ${DIRECTORS_POS.length}`}
          people={DIRECTORS_POS}
          negative={DIRECTORS_NEG}
        />
        <PeopleCard
          title="Actors"
          hint={`Top ${ACTORS_POS.length}`}
          people={ACTORS_POS}
          negative={ACTORS_NEG}
        />
      </div>

      <RatingSection />

      <FeedbackSection feedback={feedback} onDelete={setConfirmDel} />

      {/* Delete feedback dialog */}
      <Dialog open={!!confirmDel} onOpenChange={(open) => !open && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove your {confirmDel?.type} on "{confirmDel?.title}"?
            </DialogTitle>
            <DialogDescription>
              This will update your taste profile. Recomputation runs in the background.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirmDel && deleteFeedback(confirmDel)}>
              Remove feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset overrides dialog */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all manual overrides?</DialogTitle>
            <DialogDescription>
              This restores the fully computed profile. Your feedback history is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button onClick={resetAllOverrides}>Reset overrides</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebuild profile dialog */}
      <Dialog open={confirmRebuild} onOpenChange={setConfirmRebuild}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild profile from scratch?</DialogTitle>
            <DialogDescription>
              Recomputes every score from your full feedback history. Manual overrides are
              preserved. This takes a few seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRebuild(false)}>
              Cancel
            </Button>
            <Button onClick={() => setConfirmRebuild(false)}>
              <SparklesIcon />
              Rebuild profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
