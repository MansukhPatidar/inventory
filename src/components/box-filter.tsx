"use client";

export function LocationFilter({
  locations,
  selected,
  onSelect,
}: {
  locations: string[];
  selected: string | null;
  onSelect: (location: string | null) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      <FilterChip active={selected === null} onClick={() => onSelect(null)}>
        All
      </FilterChip>
      {locations.map((loc) => (
        <FilterChip
          key={loc}
          active={selected === loc}
          onClick={() => onSelect(loc)}
        >
          {loc}
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip({
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
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
          : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
