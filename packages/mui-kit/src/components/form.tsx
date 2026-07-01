// MeridianForm — the kit's own MUI form (lifted from @aion/ui's FormView pattern,
// generalized + dependency-free). Renders typed field descriptors (text / number /
// select) as MUI inputs in a Card, with a submit button. READONLY detail cards use
// `disabled` fields; EDIT forms wire onChange + submit.

import type { ReactNode } from "react";

import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

interface BaseField {
  key: string;
  label: string;
  helperText?: string;
  disabled?: boolean;
}
export type MeridianFormField =
  | (BaseField & { type?: "text"; value: string; onChange: (value: string) => void })
  | (BaseField & { type: "number"; value: number; onChange: (value: number) => void })
  | (BaseField & {
      type: "select";
      value: string;
      onChange: (value: string) => void;
      options: { value: string; label: string }[];
    });

export interface MeridianFormSubmit {
  label: string;
  onSubmit: () => void;
  disabled?: boolean;
}

export interface MeridianFormProps {
  title?: string;
  description?: ReactNode;
  fields: MeridianFormField[];
  submit: MeridianFormSubmit;
}

function renderField(field: MeridianFormField): ReactNode {
  if (field.type === "select") {
    return (
      <TextField
        key={field.key}
        select
        fullWidth
        label={field.label}
        value={field.value}
        helperText={field.helperText}
        disabled={field.disabled}
        onChange={(event) => field.onChange(event.target.value)}
      >
        {field.options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (field.type === "number") {
    return (
      <TextField
        key={field.key}
        fullWidth
        type="number"
        label={field.label}
        value={field.value}
        helperText={field.helperText}
        disabled={field.disabled}
        onChange={(event) => field.onChange(Number.parseInt(event.target.value, 10) || 0)}
      />
    );
  }
  return (
    <TextField
      key={field.key}
      fullWidth
      label={field.label}
      value={field.value}
      helperText={field.helperText}
      disabled={field.disabled}
      onChange={(event) => field.onChange(event.target.value)}
    />
  );
}

export function MeridianForm({
  title,
  description,
  fields,
  submit,
}: MeridianFormProps): ReactNode {
  return (
    <Card variant="outlined">
      <CardContent>
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            submit.onSubmit();
          }}
        >
          {title ? (
            <Typography variant="h6" gutterBottom>
              {title}
            </Typography>
          ) : null}
          {description ? <Box sx={{ mb: 2 }}>{description}</Box> : null}
          <Stack spacing={2}>
            {fields.map(renderField)}
            <Button type="submit" variant="contained" disabled={submit.disabled}>
              {submit.label}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
