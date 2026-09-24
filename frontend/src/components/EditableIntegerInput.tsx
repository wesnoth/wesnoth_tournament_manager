import React, { useEffect, useState } from 'react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: number;
  min: number;
  max?: number;
  onValueChange: (value: number) => void;
};

/**
 * Keep a temporary text draft while the user replaces a number. Required
 * numeric model fields retain their last valid value until a complete integer
 * is entered; an empty or out-of-range draft is restored on blur.
 */
const EditableIntegerInput: React.FC<Props> = ({ value, min, max, onValueChange, onFocus, onBlur, onKeyDown, ...inputProps }) => {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const parsed = draft === '' ? null : Number(draft);
  const valid = parsed !== null && Number.isSafeInteger(parsed)
    && parsed >= min && (max == null || parsed <= max);
  return <input
    {...inputProps}
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    value={draft}
    aria-invalid={inputProps['aria-invalid'] || !valid}
    onFocus={event => { setEditing(true); onFocus?.(event); }}
    onChange={event => {
      const next = event.target.value;
      if (next !== '' && !/^\d+$/.test(next)) return;
      setDraft(next);
      const nextValue = Number(next);
      if (next !== '' && Number.isSafeInteger(nextValue)
        && nextValue >= min && (max == null || nextValue <= max)) onValueChange(nextValue);
    }}
    onBlur={event => {
      setEditing(false);
      setDraft(String(value));
      onBlur?.(event);
    }}
    onKeyDown={event => {
      if (event.key === 'Enter' && !valid) event.preventDefault();
      onKeyDown?.(event);
    }}
  />;
};

export default EditableIntegerInput;
