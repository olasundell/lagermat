import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue
} from "react-aria-components";

interface ContextSelectProps {
  ariaLabel: string;
  name: string;
  icon: ReactNode;
  value: string | null;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}

export function ContextSelect({ ariaLabel, name, icon, value, options, onChange }: ContextSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      name={name}
      selectedKey={value ?? ""}
      onSelectionChange={(key) => onChange(String(key))}
      className="context-select"
      isDisabled={options.length === 0}
      placeholder="Saknas"
    >
      <Button className="context-select__button">
        {icon}
        <SelectValue />
        <ChevronDown aria-hidden="true" size={18} />
      </Button>
      <Popover className="context-select__popover" placement="bottom start">
        <ListBox className="context-select__list" items={options}>
          {(option) => (
            <ListBoxItem id={option.id} className="context-select__option">
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
