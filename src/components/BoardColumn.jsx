// Shared kanban column pieces (Nov 2026, UI batch 3). Five boards drew their
// column headers two different ways — the Pipeline with a 4px top border and a
// big filled count, the other four with an inline dot — and each wrote its own
// empty-column text. Same header, same empty state everywhere now.

export function BoardColumnHeader({ label, color, count }) {
  return (
    <div className="board-col-head" style={{ '--col-color': color }}>
      <span className="board-col-head__dot" aria-hidden="true" />
      <span className="board-col-head__label">{label}</span>
      <span className="board-col-head__count" aria-label={`${count} in ${label}`}>{count}</span>
    </div>
  )
}

export function BoardColumnEmpty({ noun = 'cards' }) {
  return <div className="board-col-empty">No {noun} here — drag one in</div>
}
