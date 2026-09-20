/** Required attribution (Panta API Terms §6). Keep visible wherever Panta data or flows appear. */
export function PoweredByPanta({ compact = false }: { compact?: boolean }) {
  return (
    <a href="https://panta.market" target="_blank" rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-fog no-underline hover:border-fog-2 hover:text-paper hover:no-underline ${compact ? '' : 'bg-ink-2'}`}
      aria-label="Powered by Panta (opens panta.market)">
      <span className="h-2 w-2 rounded-sm bg-amber" aria-hidden />
      <span>Powered by <strong className="font-semibold text-paper">Panta</strong></span>
    </a>
  );
}
