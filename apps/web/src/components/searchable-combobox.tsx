'use client';

import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import styles from './searchable-combobox.module.css';
import { filterCatalogItems, type SearchableCatalogItem } from '@/lib/catalog-search';

export type SearchableComboboxOption = SearchableCatalogItem & {
  historical?: boolean;
};

type SearchableComboboxProps<T extends SearchableComboboxOption> = {
  id: string;
  options: readonly T[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  required?: boolean;
  describedBy?: string;
  emptyText?: string;
  getOptionLabel?: (option: T) => string;
};

export function SearchableCombobox<T extends SearchableComboboxOption>({
  id,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  loading = false,
  invalid = false,
  required = false,
  describedBy,
  emptyText = 'Ничего не найдено',
  getOptionLabel = defaultOptionLabel,
}: SearchableComboboxProps<T>) {
  const generatedId = useId().replace(/:/g, '');
  const listboxId = `${id}-${generatedId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);
  const selectedLabel = selected ? getOptionLabel(selected) : '';
  const [draftQuery, setDraftQuery] = useState<string | null>(null);
  const query = draftQuery ?? selectedLabel;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [controlSnapshot, setControlSnapshot] = useState({ disabled, loading, value });

  if (
    controlSnapshot.value !== value ||
    controlSnapshot.disabled !== disabled ||
    controlSnapshot.loading !== loading
  ) {
    setControlSnapshot({ disabled, loading, value });
    setDraftQuery(null);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function restoreSelectionAndClose() {
    setDraftQuery(null);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  useEffect(() => {
    function closeFromOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setDraftQuery(null);
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }

    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, []);

  const visibleOptions = useMemo(() => {
    return filterCatalogItems(options, draftQuery ?? '');
  }, [draftQuery, options]);

  const activeOption = isOpen && activeIndex >= 0 ? visibleOptions[activeIndex] : undefined;
  const activeOptionId = activeOption ? `${listboxId}-option-${activeIndex}` : undefined;

  useEffect(() => {
    if (!activeOptionId) return;

    document
      .getElementById(activeOptionId)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeOptionId]);

  function selectOption(option: T) {
    onChange(option.id);
    setDraftQuery(null);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;
    const nextOptions = filterCatalogItems(options, nextQuery);

    setDraftQuery(nextQuery);
    setIsOpen(true);
    setActiveIndex(nextOptions.length > 0 ? 0 : -1);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;

    restoreSelectionAndClose();
  }

  function openList() {
    if (disabled || loading) return;

    const selectedIndex = visibleOptions.findIndex((option) => option.id === value);
    setIsOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : visibleOptions.length > 0 ? 0 : -1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled || loading) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        visibleOptions.length === 0 ? -1 : Math.min(current + 1, visibleOptions.length - 1),
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        visibleOptions.length === 0 ? -1 : current <= 0 ? visibleOptions.length - 1 : current - 1,
      );
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      const option = activeIndex >= 0 ? visibleOptions[activeIndex] : undefined;
      if (option) {
        selectOption(option);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      restoreSelectionAndClose();
    }
  }

  return (
    <div className={styles.root} ref={rootRef} onBlur={handleBlur}>
      <input
        className={`${styles.input} ${invalid ? styles.invalid : ''}`}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-busy={loading ? 'true' : undefined}
        aria-invalid={invalid ? 'true' : undefined}
        aria-required={required ? 'true' : undefined}
        aria-describedby={describedBy}
        value={query}
        placeholder={loading ? 'Загружаем…' : placeholder}
        disabled={disabled || loading}
        required={required}
        autoComplete="off"
        onChange={handleInput}
        onClick={openList}
        onFocus={openList}
        onKeyDown={handleKeyDown}
      />
      <span className={styles.indicator} aria-hidden="true">
        {loading ? '…' : '▾'}
      </span>
      {isOpen ? (
        <div className={styles.popup}>
          <ul
            className={styles.listbox}
            id={listboxId}
            role="listbox"
            aria-label={`${placeholder}: варианты`}
          >
            {visibleOptions.map((option, index) => (
              <li
                className={`${styles.option} ${index === activeIndex ? styles.activeOption : ''} ${
                  option.id === value ? styles.selectedOption : ''
                }`}
                id={`${listboxId}-option-${index}`}
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                onPointerDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
                onPointerMove={() => setActiveIndex(index)}
              >
                {getOptionLabel(option)}
              </li>
            ))}
          </ul>
          {visibleOptions.length === 0 ? (
            <div className={styles.empty} role="status" aria-live="polite">
              {emptyText}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function defaultOptionLabel(option: SearchableComboboxOption): string {
  return `${option.name}${option.historical ? ' (текущее историческое значение)' : ''}`;
}
