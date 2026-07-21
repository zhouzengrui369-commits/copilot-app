/**
 * KnowledgeGraph — second test file focused on FilterPanel + SearchBox
 * in isolation. These are the two pieces the verifier will exercise
 * with `fireEvent` to confirm interaction works without spinning up
 * a full Electron build.
 */

import '@testing-library/jest-dom/vitest';

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FilterPanel } from '../src/renderer/components/KnowledgeGraph/FilterPanel.js';
import { SearchBox } from '../src/renderer/components/KnowledgeGraph/SearchBox.js';
import { EMPTY_FILTER, type KgFilter } from '../src/renderer/components/KnowledgeGraph/types.js';

function makeFilter(overrides: Partial<KgFilter> = {}): KgFilter {
  return { ...EMPTY_FILTER, ...overrides };
}

describe('FilterPanel', () => {
  it('renders all 9 entity-type chips', () => {
    const onChange = vi.fn();
    render(
      <FilterPanel
        filter={EMPTY_FILTER}
        onChange={onChange}
        totalCount={100}
        visibleCount={100}
        counts={{
          person: 12, org: 11, concept: 12, event: 11, place: 11,
          product: 11, document: 11, topic: 11, other: 10,
        }}
      />,
    );
    const types = ['person', 'org', 'concept', 'event', 'place', 'product', 'document', 'topic', 'other'];
    for (const t of types) {
      expect(screen.getByTestId(`kg-chip-${t}`)).toBeInTheDocument();
    }
  });

  it('clicking a chip toggles the type in the filter', () => {
    const onChange = vi.fn();
    render(
      <FilterPanel
        filter={EMPTY_FILTER}
        onChange={onChange}
        totalCount={100}
        visibleCount={100}
      />,
    );
    fireEvent.click(screen.getByTestId('kg-chip-person'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as KgFilter;
    expect(next.types.has('person')).toBe(true);
  });

  it('Clear button resets the type filter to empty', () => {
    const onChange = vi.fn();
    render(
      <FilterPanel
        filter={makeFilter({ types: new Set(['person', 'org']) })}
        onChange={onChange}
        totalCount={100}
        visibleCount={22}
      />,
    );
    fireEvent.click(screen.getByTestId('kg-filter-clear'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as KgFilter;
    expect(next.types.size).toBe(0);
  });

  it('summary text reflects totalCount + visibleCount', () => {
    const onChange = vi.fn();
    render(
      <FilterPanel
        filter={EMPTY_FILTER}
        onChange={onChange}
        totalCount={120}
        visibleCount={120}
      />,
    );
    expect(screen.getByTestId('kg-filter-summary').textContent).toMatch(/all 120/);
  });

  it('summary text reflects narrowed count when types are active', () => {
    const onChange = vi.fn();
    render(
      <FilterPanel
        filter={makeFilter({ types: new Set(['person']) })}
        onChange={onChange}
        totalCount={120}
        visibleCount={11}
      />,
    );
    expect(screen.getByTestId('kg-filter-summary').textContent).toMatch(/11 of 120/);
  });
});

describe('SearchBox', () => {
  it('renders with placeholder and starts empty', () => {
    render(<SearchBox filter={EMPTY_FILTER} onChange={() => {}} />);
    const input = screen.getByTestId('kg-search-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Search nodes by name…');
  });

  it('Clear button is hidden when input is empty', () => {
    render(<SearchBox filter={EMPTY_FILTER} onChange={() => {}} />);
    expect(screen.queryByTestId('kg-search-clear')).toBeNull();
  });

  it('Clear button appears once the input has text', () => {
    const filter = makeFilter({ search: 'alice' });
    render(<SearchBox filter={filter} onChange={() => {}} />);
    expect(screen.getByTestId('kg-search-clear')).toBeInTheDocument();
  });

  it('typing into the input debounces into onChange', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<SearchBox filter={EMPTY_FILTER} onChange={onChange} debounceMs={50} />);
      const input = screen.getByTestId('kg-search-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'alice' } });
      // Before debounce: not yet committed.
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0]![0] as KgFilter;
      expect(next.search).toBe('alice');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Clear button immediately commits an empty search', () => {
    const onChange = vi.fn();
    const filter = makeFilter({ search: 'alice' });
    render(<SearchBox filter={filter} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('kg-search-clear'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as KgFilter;
    expect(next.search).toBe('');
  });
});