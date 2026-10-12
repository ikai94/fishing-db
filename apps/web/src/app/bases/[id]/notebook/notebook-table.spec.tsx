import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  type BaseFishNotebook,
  type PersonalNotebookFields,
  saveBaseFishNotebookEntry,
  setBaseFishNotebookVisibility,
} from '@/lib/base-fish-notebook-api';
import { updateAdminNightMark } from '@/lib/records-api';
import { NotebookTable } from './notebook-table';
import styles from './notebook.module.css';

vi.mock('@/lib/base-fish-notebook-api', () => ({
  saveBaseFishNotebookEntry: vi.fn(),
  setBaseFishNotebookVisibility: vi.fn(),
}));
vi.mock('@/lib/records-api', () => ({ updateAdminNightMark: vi.fn() }));
const notebook: BaseFishNotebook = {
  base: { id: 'base', name: 'База' },
  rows: [
    {
      fish: { id: 'fish-a', name: 'Щука', image: null, isRarest: false, isNightBiting: false },
      minWeightGrams: 123,
      maxWeightGrams: 456,
      topLocations: [],
      totalCatchReports: 0,
      isHidden: false,
      noteText: 'Сохранённая заметка',
    },
    {
      fish: { id: 'fish-b', name: 'Сом', image: null, isRarest: false, isNightBiting: false },
      minWeightGrams: null,
      maxWeightGrams: null,
      topLocations: [],
      totalCatchReports: 0,
      isHidden: false,
      noteText: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveBaseFishNotebookEntry).mockReset();
  vi.mocked(setBaseFishNotebookVisibility).mockReset();
  vi.mocked(updateAdminNightMark).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockNoteMeasurements(heights: Record<string, number>) {
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    if (element instanceof HTMLTextAreaElement)
      return new Proxy(style, {
        get(target, key) {
          if (key === 'borderTopWidth' || key === 'borderBottomWidth') return '1px';
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    return style;
  });
  return vi
    .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function (this: HTMLTextAreaElement) {
      return heights[this.value] ?? 26;
    });
}

test('initial saved multiline notes fit their measured content while empty rows stay compact', () => {
  mockNoteMeasurements({ 'Первая строка\nВторая строка\nТретья строка': 66 });
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          { ...notebook.rows[0]!, noteText: 'Первая строка\nВторая строка\nТретья строка' },
          notebook.rows[1]!,
        ],
      }}
    />,
  );
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toHaveStyle({ height: '68px' });
  expect(screen.getByRole('textbox', { name: 'Заметка — Сом' })).toHaveStyle({ height: '28px' });
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('typing, pasting, removing and cancelling text grow and shrink only the edited row', async () => {
  const user = userEvent.setup();
  const wrapped = 'Длинная строка без явных переводов строки, перенесённая по ширине';
  mockNoteMeasurements({ 'Много\nстрок\nзаметки': 66, [wrapped]: 106 });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  const other = screen.getByRole('textbox', { name: 'Заметка — Сом' });
  fireEvent.change(note, { target: { value: 'Много\nстрок\nзаметки' } });
  expect(note).toHaveStyle({ height: '68px' });
  expect(other).toHaveStyle({ height: '28px' });
  await user.click(other);
  await user.paste(wrapped);
  expect(other).toHaveValue(wrapped);
  expect(other).toHaveStyle({ height: '108px' });
  expect(note).toHaveStyle({ height: '68px' });
  fireEvent.change(note, { target: { value: 'Коротко' } });
  expect(note).toHaveStyle({ height: '28px' });
  fireEvent.change(note, { target: { value: 'Много\nстрок\nзаметки' } });
  await user.click(screen.getByRole('button', { name: 'Отменить изменения — Щука' }));
  expect(note).toHaveValue('Сохранённая заметка');
  expect(note).toHaveStyle({ height: '28px' });
  expect(other).toHaveStyle({ height: '108px' });
  await user.clear(other);
  expect(other).toHaveStyle({ height: '28px' });
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('width changes remeasure wrapped drafts once per frame and ignore height-only observations', () => {
  let width = 500;
  let contentHeight = 26;
  const observers: ResizeObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const measurement = mockNoteMeasurements({});
  measurement.mockImplementation(() => contentHeight);
  vi.spyOn(HTMLTextAreaElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width }) as DOMRect,
  );
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
  const view = render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Длинный несохранённый текст' } });
  measurement.mockClear();
  act(() => observers[0]!([], {} as ResizeObserver));
  expect(frames).toHaveLength(0);
  expect(measurement).not.toHaveBeenCalled();
  width = 250;
  contentHeight = 86;
  act(() => {
    observers[0]!([], {} as ResizeObserver);
    observers[0]!([], {} as ResizeObserver);
    window.dispatchEvent(new Event('resize'));
  });
  // У каждой строки свой кадр; observer и window resize не создают дубли для одной строки.
  expect(frames).toHaveLength(2);
  act(() => {
    frames.splice(0).forEach((callback) => callback(0));
  });
  expect(note).toHaveStyle({ height: '88px' });
  expect(note).toHaveValue('Длинный несохранённый текст');
  contentHeight = 26;
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  act(() => {
    frames.splice(0).forEach((callback) => callback(0));
  });
  expect(note).toHaveStyle({ height: '28px' });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(cancelFrame).toHaveBeenCalledTimes(2);
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('Enter saves without inserting a newline, prevents concurrent saves and reloads the saved text', async () => {
  const user = userEvent.setup();
  let complete!: (fields: PersonalNotebookFields) => void;
  vi.mocked(saveBaseFishNotebookEntry).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  await user.clear(note);
  await user.type(note, 'Новый текст{Enter}');
  expect(note).toHaveValue('Новый текст');
  expect(note).toBeDisabled();
  fireEvent.keyDown(note, { key: 'Enter' });
  fireEvent.keyDown(note, { key: 'Enter', repeat: true });
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledTimes(1);
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledWith(
    'base',
    'fish-a',
    { noteText: 'Новый текст' },
    expect.any(AbortSignal),
  );
  await act(async () => complete({ noteText: 'Новый текст' }));
  expect(within(note.closest('tr')!).getByRole('status')).toHaveTextContent('Сохранено');
  view.unmount();
  render(
    <NotebookTable
      notebook={{ ...notebook, rows: [{ ...notebook.rows[0]!, noteText: 'Новый текст' }] }}
    />,
  );
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toHaveValue('Новый текст');
});

test('unchanged Enter does not insert a newline or request a save', async () => {
  const user = userEvent.setup();
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  await user.click(note);
  await user.keyboard('{Enter}');
  expect(note).toHaveValue('Сохранённая заметка');
  const empty = screen.getByRole('textbox', { name: 'Заметка — Сом' });
  await user.click(empty);
  await user.keyboard('{Enter}');
  expect(empty).toHaveValue('');
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test.each([
  [2, 2, 'аб\nвгд', 3],
  [1, 4, 'а\nд', 2],
] as const)(
  'Alt+Enter uses the current cursor/selection (%s, %s) and preserves surrounding text',
  async (start, end, result, caret) => {
    const user = userEvent.setup();
    render(
      <NotebookTable
        notebook={{ ...notebook, rows: [{ ...notebook.rows[0]!, noteText: 'абвгд' }] }}
      />,
    );
    const note = screen.getByRole('textbox', { name: 'Заметка — Щука' }) as HTMLTextAreaElement;
    await user.click(note);
    note.setSelectionRange(start, end, 'backward');
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    expect(note).toHaveValue(result);
    expect(note.selectionStart).toBe(caret);
    expect(note.selectionEnd).toBe(caret);
    expect(note).toHaveFocus();
    expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
    await user.keyboard('я');
    expect(note).toHaveValue(`${result.slice(0, caret)}я${result.slice(caret)}`);
  },
);

test('Alt+Enter respects the text limit and handles an unchanged newline replacement', async () => {
  const user = userEvent.setup();
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          { ...notebook.rows[0]!, noteText: 'x'.repeat(5000) },
          { ...notebook.rows[1]!, noteText: 'а\nб' },
        ],
      }}
    />,
  );
  const full = screen.getByRole('textbox', { name: 'Заметка — Щука' }) as HTMLTextAreaElement;
  await user.click(full);
  full.setSelectionRange(2, 2);
  await user.keyboard('{Alt>}{Enter}{/Alt}');
  expect(full).toHaveValue('x'.repeat(5000));
  expect(full.selectionStart).toBe(2);
  const note = screen.getByRole('textbox', { name: 'Заметка — Сом' }) as HTMLTextAreaElement;
  await user.click(note);
  note.setSelectionRange(1, 2);
  await user.keyboard('{Alt>}{Enter}{/Alt}');
  expect(note).toHaveValue('а\nб');
  expect(note.selectionStart).toBe(2);
  await user.keyboard('я');
  expect(note).toHaveValue('а\nяб');
  expect(note.selectionStart).toBe(3);
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('IME Enter never saves, including native isComposing and keyCode 229', async () => {
  vi.mocked(saveBaseFishNotebookEntry).mockResolvedValue({ noteText: '日本語' });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: '日本語' } });
  fireEvent.compositionStart(note);
  expect(fireEvent.keyDown(note, { key: 'Enter' })).toBe(true);
  expect(fireEvent.keyDown(note, { key: 'Enter', altKey: true })).toBe(true);
  fireEvent.compositionEnd(note);
  fireEvent.keyDown(note, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(note, { key: 'Enter', keyCode: 229 });
  expect(note).toHaveValue('日本語');
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.keyDown(note, { key: 'Enter' });
  });
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledTimes(1);
});

test('failed Enter save keeps the multiline draft and supports retry with Enter', async () => {
  const user = userEvent.setup();
  mockNoteMeasurements({ 'Первая\nВторая': 66 });
  vi.mocked(saveBaseFishNotebookEntry)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ noteText: 'Первая\nВторая' });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  await user.clear(note);
  await user.type(note, 'Первая');
  await user.keyboard('{Alt>}{Enter}{/Alt}');
  await user.keyboard('Вторая{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Черновик сохранён в строке');
  expect(note).toHaveValue('Первая\nВторая');
  expect(note).toHaveStyle({ height: '68px' });
  expect(note).toBeEnabled();
  await user.keyboard('{Enter}');
  expect(within(note.closest('tr')!).getByRole('status')).toHaveTextContent('Сохранено');
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledTimes(2);
});

test('uses content-sized reference columns and gives remaining width to Notes with mobile cards', () => {
  const { container } = render(<NotebookTable notebook={notebook} />);
  expect([...container.querySelectorAll('col')].map((column) => column.className)).toEqual([
    styles.numberColumn,
    styles.fishColumn,
    styles.locationsColumn,
    styles.noteColumn,
    styles.weightColumn,
    styles.weightColumn,
  ]);
  const css = readFileSync('src/app/bases/[id]/notebook/notebook.module.css', 'utf8');
  expect(css).toMatch(/table-layout:\s*auto/);
  expect(css).toMatch(
    /\.numberColumn,\s*\.fishColumn,\s*\.locationsColumn,\s*\.weightColumn\s*\{\s*width:\s*1%/,
  );
  expect(css).toMatch(/\.noteColumn\s*\{\s*width:\s*100%/);
  expect(css).toContain('@media (max-width: 760px)');
  expect(css).toContain("'note note note'");
  expect(css).toMatch(/\.table th,\s*\.table td\s*\{[^}]*min-width:\s*0/);
  expect(css).toMatch(/\.fish,\s*\.locations\s*\{\s*width:\s*auto;\s*max-width:\s*100%/);
  expect(css).toMatch(/\.editor\s*\{\s*font-size:\s*16px/);
  expect(css).toMatch(/\.buttons button\s*\{\s*width:\s*44px;\s*height:\s*44px/);
});

test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])('catalog indicators are independent: rare=%s, night=%s', (isRarest, isNightBiting) => {
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          { ...notebook.rows[0]!, fish: { ...notebook.rows[0]!.fish, isRarest, isNightBiting } },
        ],
      }}
    />,
  );
  const link = screen.getByRole('link', { name: 'Щука' });
  expect(link.classList.contains(styles.rarestFishLink)).toBe(isRarest);
  expect(link).toHaveAttribute('title', 'Щука');
  const moon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
  expect(moon).toHaveAttribute('aria-pressed', String(isNightBiting));
  expect(moon.classList.contains(styles.nightButtonActive)).toBe(isNightBiting);
  expect(moon.querySelector('svg')).toHaveAttribute(
    'fill',
    isNightBiting ? 'currentColor' : 'none',
  );
  expect(moon).toHaveAttribute(
    'title',
    `${isNightBiting ? 'Снять' : 'Добавить'} общую метку ночного клёва для всех баз`,
  );
  expect(moon.previousElementSibling).toBe(link);
});

test('uses six ordered columns, number/count-only locations, and actions inside the Note cell', async () => {
  const user = userEvent.setup();
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          {
            ...notebook.rows[0]!,
            fish: { ...notebook.rows[0]!.fish, image: { url: '/fish.png' } },
            topLocations: [
              { id: 'loc-4', name: 'Затон', number: 4, reportsCount: 1943 },
              { id: 'loc-3', name: 'Протока', number: 3, reportsCount: 1830 },
              { id: 'loc-1', name: 'Деревня', number: 1, reportsCount: 937 },
            ],
          },
        ],
      }}
    />,
  );
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    '№',
    'Рыба',
    'Топ-3 локации',
    'Заметка',
    'Мин. вес',
    'Макс. вес',
  ]);
  expect(screen.getByRole('list', { name: 'Топ локаций — Щука' }).textContent).toBe(
    '4(1943), 3(1830), 1(937)',
  );
  const location = screen.getByRole('link', { name: '4. Затон — уловов: 1943' });
  expect(location).toHaveAttribute('href', '/locations/loc-4');
  expect(location).toHaveAttribute('title', '4. Затон — уловов: 1943');
  const fishLink = screen.getByRole('link', { name: 'Щука' });
  expect(fishLink).toHaveClass(styles.entityLink);
  expect(location).toHaveClass(styles.entityLink);
  const css = readFileSync('src/app/bases/[id]/notebook/notebook.module.css', 'utf8');
  expect(css).toMatch(/\.entityLink,\s*\.entityLink:visited\s*\{[^}]*text-decoration:\s*none/);
  expect(css).toMatch(/\.entityLink:hover\s*\{[^}]*text-decoration:\s*underline/);
  expect(css).toMatch(/\.table a:focus-visible\s*\{[^}]*outline:\s*2px/);
  expect(css).toMatch(/\.rarestFishLink,\s*\.rarestFishLink:visited\s*\{\s*color:\s*#b42318/);
  act(() => fishLink.focus());
  expect(fishLink).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Ночная рыба — Щука' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Скрыть рыбу — Щука' })).toHaveFocus();
  await user.tab();
  expect(location).toHaveFocus();
  expect(screen.queryByText('Затон')).not.toBeInTheDocument();
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  expect(note.closest('tr')?.children).toHaveLength(6);
  expect(screen.queryByRole('button', { name: /^Сохранить заметку/ })).not.toBeInTheDocument();
  await user.type(note, ' черновик');
  const save = screen.getByRole('button', { name: 'Сохранить заметку — Щука' });
  const cancel = screen.getByRole('button', { name: 'Отменить изменения — Щука' });
  expect(save.closest('td')).toBe(note.closest('td'));
  expect(cancel.closest('td')).toBe(note.closest('td'));
  expect(save).toHaveAttribute('title', 'Сохранить заметку');
  await user.tab();
  expect(save).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(note).toHaveValue('Сохранённая заметка');
  expect(screen.queryByRole('button', { name: /^Сохранить заметку/ })).not.toBeInTheDocument();
});

test('responsive viewport changes keep the same editor and its unsaved draft', async () => {
  const user = userEvent.setup();
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  await user.type(note, ' черновик');
  for (const width of [1440, 1024, 768, 390, 1440]) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
    expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
    expect(note).toHaveValue('Сохранённая заметка черновик');
  }
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('saving one row preserves drafts and controls in other rows, then reloads persisted values', async () => {
  const user = userEvent.setup();
  let complete!: (fields: PersonalNotebookFields) => void;
  vi.mocked(saveBaseFishNotebookEntry).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  const other = screen.getByRole('textbox', { name: 'Заметка — Сом' });
  const row = within(note.closest('tr')!);
  const otherRow = within(other.closest('tr')!);
  await user.clear(note);
  await user.type(note, 'Новый текст');
  await user.type(other, 'Несохранённый сосед');
  await user.click(row.getByRole('button', { name: /^Сохранить заметку/ }));
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledWith(
    'base',
    'fish-a',
    { noteText: 'Новый текст' },
    expect.any(AbortSignal),
  );
  expect(row.getByRole('status')).toHaveTextContent('Сохраняем…');
  expect(note).toBeDisabled();
  expect(other).toBeEnabled();
  expect(otherRow.getByRole('button', { name: /^Сохранить заметку/ })).toBeEnabled();
  await act(async () => complete({ noteText: 'Новый текст' }));
  expect(row.getByRole('status')).toHaveTextContent('Сохранено');
  expect(other).toHaveValue('Несохранённый сосед');
  expect(row.queryByRole('button', { name: /^Сохранить заметку/ })).not.toBeInTheDocument();
  view.unmount();
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [{ ...notebook.rows[0]!, noteText: 'Новый текст' }, notebook.rows[1]!],
      }}
    />,
  );
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toHaveValue('Новый текст');
  expect(screen.getByRole('textbox', { name: 'Заметка — Сом' })).toHaveValue('');
});

test('failed save keeps unsaved edits, allows retry and Cancel restores only its row', async () => {
  const user = userEvent.setup();
  vi.mocked(saveBaseFishNotebookEntry)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ noteText: 'Черновик' });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  const other = screen.getByRole('textbox', { name: 'Заметка — Сом' });
  const row = within(note.closest('tr')!);
  await user.clear(note);
  await user.type(note, 'Черновик');
  await user.type(other, 'Сосед');
  await user.click(row.getByRole('button', { name: /^Сохранить заметку/ }));
  expect(await row.findByRole('alert')).toHaveTextContent('Черновик сохранён в строке');
  expect(note).toHaveValue('Черновик');
  expect(other).toHaveValue('Сосед');
  await user.click(row.getByRole('button', { name: /^Сохранить заметку/ }));
  expect(row.getByRole('status')).toHaveTextContent('Сохранено');
  await user.type(note, ' позже');
  await user.click(row.getByRole('button', { name: /^Отменить изменения/ }));
  expect(note).toHaveValue('Черновик');
  expect(other).toHaveValue('Сосед');
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledTimes(2);
});

test('clearing the note saves an empty value and renders the canonical null response', async () => {
  const user = userEvent.setup();
  vi.mocked(saveBaseFishNotebookEntry).mockResolvedValue({ noteText: null });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  await user.clear(note);
  await user.click(within(note.closest('tr')!).getByRole('button', { name: /^Сохранить заметку/ }));
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledWith(
    'base',
    'fish-a',
    { noteText: '' },
    expect.any(AbortSignal),
  );
  expect(note).toHaveValue('');
  expect(note).toHaveAttribute('maxlength', '5000');
});

test('leaving the Base cancels an in-flight save and ignores its late response', async () => {
  const user = userEvent.setup();
  let complete!: (fields: PersonalNotebookFields) => void;
  vi.mocked(saveBaseFishNotebookEntry).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  await user.type(note, ' черновик');
  await user.click(within(note.closest('tr')!).getByRole('button', { name: /^Сохранить заметку/ }));
  const signal = vi.mocked(saveBaseFishNotebookEntry).mock.calls[0]![3]!;
  view.rerender(
    <NotebookTable
      notebook={{
        ...notebook,
        base: { id: 'other-base', name: 'Другая база' },
        rows: [{ ...notebook.rows[0]!, noteText: 'Другая пара' }],
      }}
    />,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => complete({ noteText: 'Поздний ответ' }));
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toHaveValue('Другая пара');
});

function visibleFishNames() {
  return screen.getAllByRole('rowheader').map((cell) => within(cell).getByRole('link').textContent);
}

test('instant search ignores case/extra whitespace, reports count and clears without requests or lost drafts', async () => {
  const user = userEvent.setup();
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Черновик\nна несколько строк' } });
  const search = screen.getByRole('searchbox', { name: 'Поиск рыбы' });
  await user.type(search, '  СОм  ');
  expect(visibleFishNames()).toEqual(['Сом']);
  expect(screen.getByText('Показано: 1 из 2')).toBeInTheDocument();
  expect(note.closest('tr')).toHaveAttribute('hidden');
  expect(
    within(screen.getByRole('rowheader').closest('tr')!).getAllByRole('cell')[0],
  ).toHaveTextContent('1');
  await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(visibleFishNames()).toEqual(['Щука', 'Сом']);
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
  expect(note).toHaveValue('Черновик\nна несколько строк');
  await user.type(search, 'нет такой рыбы');
  expect(screen.getByText('Нет рыб для выбранных условий.')).toBeInTheDocument();
  expect(screen.getByText('Показано: 0 из 2')).toBeInTheDocument();
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
  expect(setBaseFishNotebookVisibility).not.toHaveBeenCalled();
});

test('sorting renumbers visible rows and preserves editor identity and keyboard save', async () => {
  const user = userEvent.setup();
  vi.mocked(saveBaseFishNotebookEntry).mockResolvedValue({ noteText: 'После сортировки' });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'После сортировки' } });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Сортировка рыб' }), 'name-asc');
  expect(visibleFishNames()).toEqual(['Сом', 'Щука']);
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
  expect(within(note.closest('tr')!).getAllByRole('cell')[0]).toHaveTextContent('2');
  await user.click(note);
  await user.keyboard('{Enter}');
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledWith(
    'base',
    'fish-a',
    { noteText: 'После сортировки' },
    expect.any(AbortSignal),
  );
  await user.selectOptions(screen.getByRole('combobox'), 'default');
  expect(visibleFishNames()).toEqual(['Щука', 'Сом']);
});

test('hide/show/restore keeps drafts and measured heights, reload uses persisted visibility', async () => {
  const user = userEvent.setup();
  mockNoteMeasurements({ 'Черновик\nстрока': 66 });
  vi.mocked(setBaseFishNotebookVisibility).mockImplementation(
    async (_base, _fish, hidden) => hidden,
  );
  const view = render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Черновик\nстрока' } });
  await user.click(screen.getByRole('button', { name: 'Скрыть рыбу — Щука' }));
  expect(visibleFishNames()).toEqual(['Сом']);
  expect(note.closest('tr')).toHaveAttribute('hidden');
  expect(note).toHaveValue('Черновик\nстрока');
  expect(setBaseFishNotebookVisibility).toHaveBeenCalledWith(
    'base',
    'fish-a',
    true,
    expect.any(AbortSignal),
  );
  await user.click(screen.getByRole('checkbox', { name: 'Показать скрытые (1)' }));
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
  expect(note).toHaveStyle({ height: '68px' });
  await user.click(screen.getByRole('button', { name: 'Восстановить рыбу — Щука' }));
  expect(screen.getByRole('checkbox', { name: 'Показать скрытые (0)' })).toBeChecked();
  expect(note).toHaveValue('Черновик\nстрока');
  await user.click(screen.getByRole('button', { name: 'Отменить изменения — Щука' }));
  expect(note).toHaveValue('Сохранённая заметка');
  view.unmount();
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [{ ...notebook.rows[0]!, isHidden: true }, notebook.rows[1]!],
      }}
    />,
  );
  expect(visibleFishNames()).toEqual(['Сом']);
  await user.click(screen.getByRole('checkbox', { name: 'Показать скрытые (1)' }));
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toHaveValue(
    'Сохранённая заметка',
  );
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('failed visibility retains every draft, then save and hide can finish independently while filtered', async () => {
  const user = userEvent.setup();
  vi.mocked(setBaseFishNotebookVisibility).mockRejectedValueOnce(new Error('offline'));
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  const other = screen.getByRole('textbox', { name: 'Заметка — Сом' });
  fireEvent.change(note, { target: { value: 'Моя заметка' } });
  fireEvent.change(other, { target: { value: 'Соседняя заметка' } });
  await user.click(screen.getByRole('button', { name: 'Скрыть рыбу — Щука' }));
  expect(within(note.closest('tr')!).getByRole('alert')).toHaveTextContent(
    'Не удалось изменить видимость',
  );
  expect(note).toHaveValue('Моя заметка');
  expect(other).toHaveValue('Соседняя заметка');
  let completeNote!: (fields: PersonalNotebookFields) => void;
  let completeVisibility!: (hidden: boolean) => void;
  vi.mocked(saveBaseFishNotebookEntry).mockReturnValue(
    new Promise((resolve) => {
      completeNote = resolve;
    }),
  );
  vi.mocked(setBaseFishNotebookVisibility).mockReturnValue(
    new Promise((resolve) => {
      completeVisibility = resolve;
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить заметку — Щука' }));
  await user.click(screen.getByRole('button', { name: 'Скрыть рыбу — Щука' }));
  const hide = screen.getByRole('button', { name: 'Скрыть рыбу — Щука' });
  expect(hide).toBeDisabled();
  expect(hide).toHaveAttribute('aria-busy', 'true');
  await user.type(screen.getByRole('searchbox'), 'Сом');
  await act(async () => completeVisibility(true));
  await act(async () => completeNote({ noteText: 'Моя заметка' }));
  await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  await user.click(screen.getByRole('checkbox', { name: 'Показать скрытые (1)' }));
  expect(note).toHaveValue('Моя заметка');
  expect(within(note.closest('tr')!).getByText('Сохранено')).toBeInTheDocument();
  expect(other).toHaveValue('Соседняя заметка');
});

test('a Base change aborts pending visibility and ignores its late response', async () => {
  const user = userEvent.setup();
  let complete!: (hidden: boolean) => void;
  vi.mocked(setBaseFishNotebookVisibility).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<NotebookTable notebook={notebook} />);
  await user.click(screen.getByRole('button', { name: 'Скрыть рыбу — Щука' }));
  const signal = vi.mocked(setBaseFishNotebookVisibility).mock.calls[0]![3]!;
  view.rerender(
    <NotebookTable notebook={{ ...notebook, base: { id: 'other-base', name: 'Другая база' } }} />,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => complete(true));
  expect(screen.getByRole('checkbox', { name: 'Показать скрытые (0)' })).not.toBeChecked();
  expect(visibleFishNames()).toEqual(['Щука', 'Сом']);
});

test('moon toggles optimistically, blocks repeated clicks, saves global state and supports keyboard', async () => {
  const user = userEvent.setup();
  let complete!: (result: Awaited<ReturnType<typeof updateAdminNightMark>>) => void;
  vi.mocked(updateAdminNightMark).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<NotebookTable notebook={notebook} />);
  const moon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
  const otherMoon = screen.getByRole('button', { name: 'Ночная рыба — Сом' });
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Личный черновик\nстрока' } });
  await user.click(moon);
  expect(moon).toHaveAttribute('aria-pressed', 'true');
  expect(moon).toHaveClass(styles.nightButtonActive);
  expect(moon).toHaveAttribute('aria-busy', 'true');
  expect(moon).toBeDisabled();
  expect(otherMoon).toBeEnabled();
  expect(otherMoon).toHaveAttribute('aria-pressed', 'false');
  expect(within(moon.closest('tr')!).getByText('Сохраняем ночную метку…')).toBeInTheDocument();
  fireEvent.click(moon);
  fireEvent.click(moon);
  expect(updateAdminNightMark).toHaveBeenCalledTimes(1);
  expect(updateAdminNightMark).toHaveBeenCalledWith('fish-a', true, expect.any(AbortSignal));
  expect(note).toBeEnabled();
  expect(note).toHaveValue('Личный черновик\nстрока');
  await act(async () => complete({ fish: { fishId: 'fish-a', isNightBiting: true } }));
  expect(moon).toBeEnabled();
  expect(moon).toHaveAttribute('aria-busy', 'false');
  view.unmount();
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          { ...notebook.rows[0]!, fish: { ...notebook.rows[0]!.fish, isNightBiting: true } },
          notebook.rows[1]!,
        ],
      }}
    />,
  );
  const reloadedMoon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
  expect(reloadedMoon).toHaveAttribute('aria-pressed', 'true');
  vi.mocked(updateAdminNightMark).mockResolvedValue({
    fish: { fishId: 'fish-a', isNightBiting: false },
  });
  act(() => reloadedMoon.focus());
  await user.keyboard(' ');
  expect(reloadedMoon).toHaveAttribute('aria-pressed', 'false');
  expect(reloadedMoon.querySelector('svg')).toHaveAttribute('fill', 'none');
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
  expect(setBaseFishNotebookVisibility).not.toHaveBeenCalled();
});

test.each([false, true])(
  'failed night update rolls back from %s and preserves drafts and Enter/Alt+Enter',
  async (initial) => {
    const user = userEvent.setup();
    vi.mocked(updateAdminNightMark).mockRejectedValue(new Error('offline'));
    render(
      <NotebookTable
        notebook={{
          ...notebook,
          rows: [
            { ...notebook.rows[0]!, fish: { ...notebook.rows[0]!.fish, isNightBiting: initial } },
            notebook.rows[1]!,
          ],
        }}
      />,
    );
    const note = screen.getByRole('textbox', { name: 'Заметка — Щука' }) as HTMLTextAreaElement;
    const other = screen.getByRole('textbox', { name: 'Заметка — Сом' });
    fireEvent.change(note, { target: { value: 'Черновик' } });
    fireEvent.change(other, { target: { value: 'Другой черновик' } });
    const moon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
    act(() => moon.focus());
    await user.keyboard('{Enter}');
    expect(within(note.closest('tr')!).getByRole('alert')).toHaveTextContent(
      'Не удалось обновить ночную метку',
    );
    expect(moon).toBeEnabled();
    expect(moon).toHaveAttribute('aria-pressed', String(initial));
    expect(note).toHaveValue('Черновик');
    expect(other).toHaveValue('Другой черновик');
    await user.click(note);
    note.setSelectionRange(4, 4);
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    expect(note).toHaveValue('Черн\nовик');
    expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
    vi.mocked(saveBaseFishNotebookEntry).mockResolvedValue({ noteText: 'Черн\nовик' });
    await user.keyboard('{Enter}');
    expect(saveBaseFishNotebookEntry).toHaveBeenCalledWith(
      'base',
      'fish-a',
      { noteText: 'Черн\nовик' },
      expect.any(AbortSignal),
    );
    expect(other).toHaveValue('Другой черновик');
    vi.mocked(updateAdminNightMark).mockResolvedValue({
      fish: { fishId: 'fish-a', isNightBiting: !initial },
    });
    await user.click(moon);
    expect(moon).toHaveAttribute('aria-pressed', String(!initial));
    expect(within(note.closest('tr')!).queryByRole('alert')).not.toBeInTheDocument();
  },
);

test('night request survives search, sorting, hiding and responsive changes without losing notes', async () => {
  const user = userEvent.setup();
  let complete!: (result: Awaited<ReturnType<typeof updateAdminNightMark>>) => void;
  vi.mocked(updateAdminNightMark).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  vi.mocked(setBaseFishNotebookVisibility).mockResolvedValue(true);
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Не терять черновик' } });
  const moon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
  await user.click(moon);
  await user.selectOptions(screen.getByRole('combobox'), 'name-asc');
  await user.type(screen.getByRole('searchbox'), 'Сом');
  expect(note.closest('tr')).toHaveAttribute('hidden');
  await act(async () => complete({ fish: { fishId: 'fish-a', isNightBiting: true } }));
  await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  await user.click(screen.getByRole('button', { name: 'Скрыть рыбу — Щука' }));
  await user.click(screen.getByRole('checkbox', { name: 'Показать скрытые (1)' }));
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
  expect(note).toHaveValue('Не терять черновик');
  expect(screen.getByRole('button', { name: 'Ночная рыба — Щука' })).toBe(moon);
  expect(moon).toHaveAttribute('aria-pressed', 'true');
  expect(updateAdminNightMark).toHaveBeenCalledTimes(1);
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('leaving a Base aborts the moon request and ignores its late response', async () => {
  const user = userEvent.setup();
  let complete!: (result: Awaited<ReturnType<typeof updateAdminNightMark>>) => void;
  vi.mocked(updateAdminNightMark).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<NotebookTable notebook={notebook} />);
  await user.click(screen.getByRole('button', { name: 'Ночная рыба — Щука' }));
  const signal = vi.mocked(updateAdminNightMark).mock.calls[0]![2]!;
  view.rerender(
    <NotebookTable notebook={{ ...notebook, base: { id: 'other-base', name: 'Другая база' } }} />,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => complete({ fish: { fishId: 'fish-a', isNightBiting: true } }));
  expect(screen.getByRole('button', { name: 'Ночная рыба — Щука' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('night-only filter combines locally with search, sorting and personal hidden flags and renumbers results', async () => {
  const user = userEvent.setup();
  const rows: BaseFishNotebook['rows'] = [
    {
      ...notebook.rows[0]!,
      fish: { ...notebook.rows[0]!.fish, name: 'Щука ночная', isNightBiting: true },
      totalCatchReports: 10,
    },
    {
      ...notebook.rows[1]!,
      fish: { ...notebook.rows[1]!.fish, name: 'Сом ночной', isNightBiting: true },
      totalCatchReports: 50,
    },
    {
      ...notebook.rows[0]!,
      fish: {
        ...notebook.rows[0]!.fish,
        id: 'hidden-night',
        name: 'Амур ночной',
        isNightBiting: true,
      },
      isHidden: true,
      totalCatchReports: 30,
    },
    {
      ...notebook.rows[0]!,
      fish: { ...notebook.rows[0]!.fish, id: 'day-fish', name: 'Лещ дневной' },
      totalCatchReports: 100,
    },
    {
      ...notebook.rows[0]!,
      fish: { ...notebook.rows[0]!.fish, id: 'hidden-day', name: 'Ёрш дневной' },
      isHidden: true,
      totalCatchReports: 70,
    },
  ];
  render(<NotebookTable notebook={{ ...notebook, rows }} />);
  const filter = screen.getByRole('checkbox', { name: 'Только ночные' });
  expect(filter).not.toBeChecked();
  expect(filter.closest('label')?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(visibleFishNames()).toEqual(['Щука ночная', 'Сом ночной', 'Лещ дневной']);
  await user.click(filter);
  expect(visibleFishNames()).toEqual(['Щука ночная', 'Сом ночной']);
  expect(screen.getByText('Показано: 2 из 5')).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox'), 'catches-desc');
  expect(visibleFishNames()).toEqual(['Сом ночной', 'Щука ночная']);
  await user.click(screen.getByRole('checkbox', { name: 'Показать скрытые (2)' }));
  expect(visibleFishNames()).toEqual(['Сом ночной', 'Амур ночной', 'Щука ночная']);
  expect(screen.getByText('Показано: 3 из 5')).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), '  АМУР  ');
  expect(visibleFishNames()).toEqual(['Амур ночной']);
  expect(
    within(screen.getByRole('rowheader').closest('tr')!).getAllByRole('cell')[0],
  ).toHaveTextContent('1');
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'дневной');
  expect(screen.getByText('Показано: 0 из 5')).toBeInTheDocument();
  expect(screen.getByText('Нет рыб для выбранных условий.')).toBeInTheDocument();
  await user.click(filter);
  expect(visibleFishNames()).toEqual(['Лещ дневной', 'Ёрш дневной']);
  await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(visibleFishNames()).toEqual([
    'Лещ дневной',
    'Ёрш дневной',
    'Сом ночной',
    'Амур ночной',
    'Щука ночная',
  ]);
  expect(updateAdminNightMark).not.toHaveBeenCalled();
  expect(setBaseFishNotebookVisibility).not.toHaveBeenCalled();
  expect(saveBaseFishNotebookEntry).not.toHaveBeenCalled();
});

test('disabling night under the filter hides the mounted draft immediately and preserves pending/saved state', async () => {
  const user = userEvent.setup();
  let complete!: (result: Awaited<ReturnType<typeof updateAdminNightMark>>) => void;
  vi.mocked(updateAdminNightMark).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  mockNoteMeasurements({ 'Черновик\nвторая строка': 66 });
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          { ...notebook.rows[0]!, fish: { ...notebook.rows[0]!.fish, isNightBiting: true } },
          notebook.rows[1]!,
        ],
      }}
    />,
  );
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Черновик\nвторая строка' } });
  const filter = screen.getByRole('checkbox', { name: 'Только ночные' });
  await user.click(filter);
  const moon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
  await user.click(moon);
  expect(note.closest('tr')).toHaveAttribute('hidden');
  expect(note).toHaveValue('Черновик\nвторая строка');
  expect(screen.getByText('Показано: 0 из 2')).toBeInTheDocument();
  expect(screen.getByText('Нет рыб для выбранных условий.')).toBeInTheDocument();
  await user.click(filter);
  expect(screen.getByRole('button', { name: 'Ночная рыба — Щука' })).toBe(moon);
  expect(moon).toBeDisabled();
  expect(moon).toHaveAttribute('aria-busy', 'true');
  expect(moon).toHaveAttribute('aria-pressed', 'false');
  expect(note).toHaveStyle({ height: '68px' });
  fireEvent.click(moon);
  expect(updateAdminNightMark).toHaveBeenCalledTimes(1);
  await user.click(filter);
  await act(async () => complete({ fish: { fishId: 'fish-a', isNightBiting: false } }));
  expect(note.closest('tr')).toHaveAttribute('hidden');
  await user.click(filter);
  expect(moon).toBeEnabled();
  expect(note).toHaveValue('Черновик\nвторая строка');
  await user.click(screen.getByRole('button', { name: 'Отменить изменения — Щука' }));
  expect(note).toHaveValue('Сохранённая заметка');
});

test('failed night update returns the filtered row with its draft, error and retry controls', async () => {
  const user = userEvent.setup();
  let reject!: (reason: Error) => void;
  vi.mocked(updateAdminNightMark).mockReturnValueOnce(
    new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise;
    }),
  );
  render(
    <NotebookTable
      notebook={{
        ...notebook,
        rows: [
          { ...notebook.rows[0]!, fish: { ...notebook.rows[0]!.fish, isNightBiting: true } },
          notebook.rows[1]!,
        ],
      }}
    />,
  );
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' });
  fireEvent.change(note, { target: { value: 'Не потерять' } });
  await user.click(screen.getByRole('checkbox', { name: 'Только ночные' }));
  await user.click(screen.getByRole('button', { name: 'Ночная рыба — Щука' }));
  expect(note.closest('tr')).toHaveAttribute('hidden');
  await act(async () => reject(new Error('offline')));
  expect(visibleFishNames()).toEqual(['Щука']);
  expect(screen.getByText('Показано: 1 из 2')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
  expect(note).toHaveValue('Не потерять');
  expect(within(note.closest('tr')!).getByRole('alert')).toHaveTextContent(
    'Не удалось обновить ночную метку',
  );
  expect(screen.getByRole('button', { name: 'Ночная рыба — Щука' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  vi.mocked(updateAdminNightMark).mockResolvedValue({
    fish: { fishId: 'fish-a', isNightBiting: false },
  });
  await user.click(screen.getByRole('button', { name: 'Ночная рыба — Щука' }));
  expect(note.closest('tr')).toHaveAttribute('hidden');
  await user.click(screen.getByRole('checkbox', { name: 'Только ночные' }));
  expect(within(note.closest('tr')!).queryByRole('alert')).not.toBeInTheDocument();
  expect(note).toHaveValue('Не потерять');
});

test('filter changes preserve night edits, keyboard navigation and drafts across responsive changes', async () => {
  const user = userEvent.setup();
  vi.mocked(updateAdminNightMark).mockResolvedValue({
    fish: { fishId: 'fish-a', isNightBiting: true },
  });
  render(<NotebookTable notebook={notebook} />);
  const note = screen.getByRole('textbox', { name: 'Заметка — Щука' }) as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: 'Черновик' } });
  const filter = screen.getByRole('checkbox', { name: 'Только ночные' });
  act(() => filter.focus());
  await user.keyboard(' ');
  expect(filter).toBeChecked();
  expect(screen.getByText('Показано: 0 из 2')).toBeInTheDocument();
  await user.keyboard(' ');
  const moon = screen.getByRole('button', { name: 'Ночная рыба — Щука' });
  act(() => moon.focus());
  await user.keyboard('{Enter}');
  expect(moon).toHaveAttribute('aria-pressed', 'true');
  await user.click(filter);
  expect(visibleFishNames()).toEqual(['Щука']);
  await user.selectOptions(screen.getByRole('combobox'), 'name-desc');
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toBe(note);
  expect(note).toHaveValue('Черновик');
  await user.click(note);
  note.setSelectionRange(4, 4);
  await user.keyboard('{Alt>}{Enter}{/Alt}');
  expect(note).toHaveValue('Черн\nовик');
  vi.mocked(saveBaseFishNotebookEntry).mockResolvedValue({ noteText: 'Черн\nовик' });
  await user.keyboard('{Enter}');
  expect(saveBaseFishNotebookEntry).toHaveBeenCalledWith(
    'base',
    'fish-a',
    { noteText: 'Черн\nовик' },
    expect.any(AbortSignal),
  );
  expect(updateAdminNightMark).toHaveBeenCalledTimes(1);
});
