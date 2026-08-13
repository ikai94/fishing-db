import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type FormEvent, useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { SearchableCombobox } from './searchable-combobox';

const options = [
  { id: 'pike', name: 'Амурская Щука' },
  { id: 'sturgeon', name: 'Амурский Осетр' },
  { id: 'carp', name: 'Черный амур' },
];

function ControlledCombobox({
  initialValue = '',
  onValueChange = () => undefined,
}: {
  initialValue?: string;
  onValueChange?: (id: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <SearchableCombobox
      id="fish"
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
      placeholder="Найти рыбу"
    />
  );
}

describe('SearchableCombobox', () => {
  test('exposes combobox/listbox semantics and token search', async () => {
    const user = userEvent.setup();
    render(<ControlledCombobox />);
    const input = screen.getByRole('combobox');

    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(input);
    await user.type(input, 'амур щ');

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Амурская Щука' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Амурский Осетр' })).not.toBeInTheDocument();
  });

  test('supports arrows, Enter and Escape', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ControlledCombobox onValueChange={onSelect} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('sturgeon');
    expect(input).toHaveValue('Амурский Осетр');

    await user.click(input);
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('supports pointer selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ControlledCombobox onValueChange={onSelect} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Черный амур' }));
    expect(onSelect).toHaveBeenCalledWith('carp');
  });

  test('shows the exact empty message without a create action', async () => {
    const user = userEvent.setup();
    render(<ControlledCombobox />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'несуществующая');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeEmptyDOMElement();
    expect(screen.getByRole('status')).toHaveTextContent('Ничего не найдено');
    expect(screen.queryByRole('button', { name: /создать/i })).not.toBeInTheDocument();
  });

  test('does not implicitly submit a stale selected ID for an unmatched query', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ControlledCombobox initialValue="pike" />
        <button type="submit">Сохранить</button>
      </form>,
    );
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.clear(input);
    await user.type(input, 'несуществующая{Enter}');

    expect(input).toHaveValue('несуществующая');
    expect(screen.getByRole('status')).toHaveTextContent('Ничего не найдено');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('keeps the selected value while typing and restores its label with Escape', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ControlledCombobox initialValue="pike" onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox');

    expect(input).toHaveValue('Амурская Щука');
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'осетр');

    expect(input).toHaveValue('осетр');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Амурский Осетр' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('Амурская Щука');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test('restores the selection and closes when focus leaves with Tab', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <>
        <ControlledCombobox initialValue="pike" onValueChange={onValueChange} />
        <button type="button">Следующее поле</button>
      </>,
    );
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.clear(input);
    await user.type(input, 'осетр');
    await user.tab();

    expect(screen.getByRole('button', { name: 'Следующее поле' })).toHaveFocus();
    expect(input).toHaveValue('Амурская Щука');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test('restores the selection after an outside pointer event', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ControlledCombobox initialValue="pike" onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.clear(input);
    await user.type(input, 'осетр');
    fireEvent.pointerDown(document.body);

    expect(input).toHaveValue('Амурская Щука');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test('scrolls the keyboard-active option into view', async () => {
    const user = userEvent.setup();
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(<ControlledCombobox />);
      const input = screen.getByRole('combobox');
      await user.click(input);
      scrollIntoView.mockClear();
      await user.keyboard('{ArrowDown}');

      const activeId = input.getAttribute('aria-activedescendant');
      expect(activeId).not.toBeNull();
      expect(document.getElementById(activeId as string)).toHaveTextContent('Амурский Осетр');
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        block: 'nearest',
        inline: 'nearest',
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });

  test('exposes disabled, loading and invalid states without opening', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableCombobox
        id="fish"
        options={options}
        value=""
        onChange={onChange}
        placeholder="Найти рыбу"
        disabled
      />,
    );
    let input = screen.getByRole('combobox');
    expect(input).toBeDisabled();
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <SearchableCombobox
        id="fish"
        options={options}
        value=""
        onChange={onChange}
        placeholder="Найти рыбу"
        loading
      />,
    );
    input = screen.getByRole('combobox');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(input).toHaveAttribute('placeholder', 'Загружаем…');

    rerender(
      <SearchableCombobox
        id="fish"
        options={options}
        value=""
        onChange={onChange}
        placeholder="Найти рыбу"
        invalid
        required
        describedBy="fish-error"
      />,
    );
    input = screen.getByRole('combobox');
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'fish-error');
    expect(input).toBeRequired();
    expect(input).not.toHaveAttribute('aria-busy');
    expect(onChange).not.toHaveBeenCalled();
  });
});
