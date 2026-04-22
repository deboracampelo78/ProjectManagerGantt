import './FilterDropdown.css';

export function FilterDropdown({
  id,
  label,
  items,
  selected,
  onToggle,
  isOpen,
  onOpenChange,
  renderLabel = (item) => item,
}) {
  const selectedCount = selected.length;

  function handleSummaryClick(e) {
    e.preventDefault();
    onOpenChange(id, !isOpen);
  }

  return (
    <div className={`filterDropdown ${isOpen ? 'open' : ''}`}>
      <button
        className="filterDropdownSummary"
        onClick={handleSummaryClick}
        aria-expanded={isOpen}
      >
        <span className="filterLabel">{label}</span>
        {selectedCount > 0 && (
          <span className="filterBadge">{selectedCount}</span>
        )}
        <span className="filterIcon">▼</span>
      </button>
      {isOpen && (
        <div className="filterDropdownContent">
          {items.length === 0 ? (
            <p className="filterEmpty">Nenhuma opção disponível</p>
          ) : (
            items.map((item) => (
              <label key={item} className="filterCheckbox">
                <input
                  type="checkbox"
                  checked={selected.includes(item)}
                  onChange={() => onToggle(item)}
                />
                <span>{renderLabel(item)}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
