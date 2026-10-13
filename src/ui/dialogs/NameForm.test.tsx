import { fireEvent, render, screen } from '@testing-library/react';
import { NameForm, type NameFormProps } from './NameForm';

// Friends' own rename is tested through FriendsDialog; these pin what another
// list sets for itself.
function renderForm(overrides: Partial<NameFormProps> = {}) {
  const props: NameFormProps = {
    initial: 'The Times #1,234',
    label: 'Name',
    hint: 'Leave it empty for none.',
    maxLength: 80,
    normalise: (name) => name.trim().toUpperCase(),
    context: 'The Times #1,234, from Today 14:05',
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<NameForm {...props} />);
  return props;
}

const field = () => screen.getByRole('textbox', { name: 'Name' });

describe('NameForm', () => {
  it('opens on the name given, focused and selected, in the words it is given', () => {
    renderForm();
    expect(
      screen.getByRole('group', { name: 'Rename The Times #1,234, from Today 14:05' }),
    ).toContainElement(field());
    expect(field()).toHaveValue('The Times #1,234');
    expect(field()).toHaveFocus();
    const input = field() as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 16]);
    expect(field()).toHaveAccessibleDescription('Leave it empty for none.');
    expect(field()).toHaveAttribute('maxLength', '80');
  });

  it('tidies with the tidier it is given as the field loses focus', () => {
    renderForm();
    fireEvent.change(field(), { target: { value: '  my best ' } });
    fireEvent.blur(field());
    expect(field()).toHaveValue('MY BEST');
  });

  it('saves the raw text, for the parent to tidy, on Save or on Enter', () => {
    const props = renderForm({ initial: '' });
    fireEvent.change(field(), { target: { value: ' Mine ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save name, The Times/ }));
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(props.onSave).toHaveBeenNthCalledWith(1, ' Mine ');
    expect(props.onSave).toHaveBeenNthCalledWith(2, ' Mine ');
  });

  it('claims Escape, so the dialog stays open, and cancels', () => {
    const props = renderForm();
    expect(fireEvent.keyDown(field(), { key: 'Escape' })).toBe(false);
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(field(), { key: 'a' })).toBe(true);
    expect(props.onCancel).toHaveBeenCalledOnce();
  });
});
