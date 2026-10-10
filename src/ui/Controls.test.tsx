import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Controls, type ControlsProps } from './Controls';

function renderControls(overrides: Partial<ControlsProps> = {}) {
  const props: ControlsProps = {
    mode: 'normal',
    autoCandidates: false,
    counts: new Array<number>(10).fill(0),
    isDisabled: false,
    canUndo: true,
    canRedo: true,
    canCheckCell: true,
    canCheckPuzzle: true,
    canRevealCell: true,
    onSetMode: vi.fn(),
    onDigit: vi.fn(),
    onErase: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSetAutoCandidates: vi.fn(),
    onHint: vi.fn(),
    onCheckCell: vi.fn(),
    onCheckPuzzle: vi.fn(),
    onRevealCell: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  const view = render(<Controls {...props} />);
  return { ...view, props };
}

describe('Controls', () => {
  it('shows the mode as a pair of pressed and unpressed buttons', () => {
    const { props, rerender } = renderControls();
    const group = screen.getByRole('group', { name: 'Input mode' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Candidate' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Candidate' }));
    expect(props.onSetMode).toHaveBeenCalledWith('candidate');
    rerender(<Controls {...props} mode="candidate" />);
    expect(screen.getByRole('button', { name: 'Candidate' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('enters digits from the pad and erases', () => {
    const { props } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(props.onDigit).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    expect(props.onErase).toHaveBeenCalledTimes(1);
  });

  it('undoes and redoes, while there is something to undo or redo', () => {
    const { props, rerender } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onRedo).toHaveBeenCalledTimes(1);
    rerender(<Controls {...props} canUndo={false} canRedo={false} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('switches auto candidate mode as a switch', () => {
    const { props, rerender } = renderControls();
    const toggle = screen.getByRole('switch', { name: 'Auto Candidate Mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(props.onSetAutoCandidates).toHaveBeenCalledWith(true);
    rerender(<Controls {...props} autoCandidates />);
    fireEvent.click(screen.getByRole('switch', { name: 'Auto Candidate Mode' }));
    expect(props.onSetAutoCandidates).toHaveBeenLastCalledWith(false);
  });

  it('runs the "…" menu’s help and checks', () => {
    const { props } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check puzzle' }));
    expect(props.onCheckPuzzle).toHaveBeenCalledTimes(1);
  });

  it('puts the hints used on the "…" menu’s Hint', () => {
    renderControls({ hintsUsed: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Hint (3 used)' })).toBeInTheDocument();
  });

  it('disables Check puzzle when it has nothing to check', () => {
    renderControls({ canCheckPuzzle: false });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Check puzzle' })).toBeDisabled();
  });

  it('keeps a mouse press on any control from taking focus', () => {
    renderControls();
    for (const control of [
      ...screen.getAllByRole('button'),
      screen.getByRole('switch', { name: 'Auto Candidate Mode' }),
    ]) {
      // fireEvent returns false when the default (focusing) was prevented.
      expect(fireEvent.mouseDown(control)).toBe(false);
    }
  });

  it('makes everything inert while the board is hidden or solved', () => {
    renderControls({ isDisabled: true });
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
