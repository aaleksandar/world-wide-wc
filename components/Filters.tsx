"use client";

import { useState } from "react";
import {
  Accessibility,
  Baby,
  Bot,
  Clock,
  Music,
  Droplets,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  User,
  UserCheck,
  Users,
  Wind,
  X,
} from "lucide-react";
import {
  AMENITY_KEYS,
  AMENITY_LABELS,
  type AmenityKey,
  type Filters,
  NO_FILTERS,
  countActive,
} from "@/lib/filters";
import { ACCESS, type Access } from "@/lib/payload";

const ACCESS_LABELS: Record<Access, string> = {
  free: "Free",
  paid: "Paid",
  customer: "Customers only",
  unknown: "Unknown",
};

const AMENITY_ICONS: Record<AmenityKey, React.ReactNode> = {
  hasPaper: <ScrollText className="size-3.5" aria-hidden />,
  isAccessible: <Accessibility className="size-3.5" aria-hidden />,
  hasChangingTable: <Baby className="size-3.5" aria-hidden />,
  isStaffed: <UserCheck className="size-3.5" aria-hidden />,
  hasBidet: <Droplets className="size-3.5" aria-hidden />,
  hasMusic: <Music className="size-3.5" aria-hidden />,
};

export function FilterPanel({
  filters,
  onChange,
  showing,
  total,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  showing: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const active = countActive(filters);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="w-full max-w-sm rounded-xl bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-expanded={open}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {active > 0 ? (
            <span className="rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white">
              {active}
            </span>
          ) : null}
        </button>

        {/* The two people reach for most, always one tap away. */}
        <Chip active={filters.access.includes("free")} onClick={() => set("access", toggle(filters.access, "free" as Access))}>
          Free
        </Chip>
        <Chip active={filters.openNow} onClick={() => set("openNow", !filters.openNow)}>
          <Clock className="size-3.5" aria-hidden />
          Open now
        </Chip>

        <span className="ml-auto pr-1 text-xs tabular-nums text-zinc-500">
          {showing === total ? total : `${showing}/${total}`}
        </span>
      </div>

      {open ? (
        <div className="max-h-[55vh] space-y-4 overflow-y-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
          <Group label="Getting in">
            <div className="flex flex-wrap gap-1.5">
              {ACCESS.map((option) => (
                <Chip
                  key={option}
                  active={filters.access.includes(option)}
                  onClick={() => set("access", toggle(filters.access, option))}
                >
                  {ACCESS_LABELS[option]}
                </Chip>
              ))}
            </div>
          </Group>

          <Group label="Must have">
            <div className="flex flex-wrap gap-1.5">
              {AMENITY_KEYS.map((key) => (
                <Chip
                  key={key}
                  active={filters.amenities.includes(key)}
                  onClick={() => set("amenities", toggle(filters.amenities, key))}
                >
                  {AMENITY_ICONS[key]}
                  {AMENITY_LABELS[key]}
                </Chip>
              ))}
            </div>
          </Group>

          <Scale
            label="Cleanliness"
            icon={<Sparkles className="size-3.5" aria-hidden />}
            value={filters.minCleanliness}
            onChange={(value) => set("minCleanliness", value)}
            hint="at least"
          />
          <Scale
            label="Smell"
            icon={<Wind className="size-3.5" aria-hidden />}
            value={filters.minSmell}
            onChange={(value) => set("minSmell", value)}
            hint="at least"
          />
          <Scale
            label="Busyness"
            icon={<Users className="size-3.5" aria-hidden />}
            value={filters.maxBusyness}
            onChange={(value) => set("maxBusyness", value)}
            hint="at most"
          />

          {filters.minCleanliness || filters.minSmell || filters.maxBusyness ? (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              Rating filters hide toilets nobody has rated. Most of this map is unrated —
              an absent rating isn&apos;t a good one.
            </p>
          ) : null}

          <Group label="Who found it">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["any", "Anyone", null],
                  ["human", "A person", <User key="u" className="size-3.5" aria-hidden />],
                  ["agent", "An agent", <Bot key="b" className="size-3.5" aria-hidden />],
                ] as const
              ).map(([value, label, icon]) => (
                <Chip key={value} active={filters.source === value} onClick={() => set("source", value)}>
                  {icon}
                  {label}
                </Chip>
              ))}
            </div>
          </Group>

          {active > 0 ? (
            <button
              type="button"
              onClick={() => onChange(NO_FILTERS)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-100 py-2 text-sm hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              <X className="size-3.5" aria-hidden />
              Clear {active} {active === 1 ? "filter" : "filters"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-500">{label}</p>
      {children}
    </div>
  );
}

function Scale({
  label,
  icon,
  value,
  onChange,
  hint,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
        {icon}
        {label}
        <span className="font-normal text-zinc-400">{value ? hint : "any"}</span>
      </p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((step) => (
          <Chip key={step} active={value === step} onClick={() => onChange(value === step ? 0 : step)}>
            {step}
            {step === 5 ? "" : "+"}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
        active
          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}
