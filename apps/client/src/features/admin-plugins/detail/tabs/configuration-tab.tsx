import { useEffect, useMemo, useState } from "react";
import { isEqual } from "es-toolkit";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  SchemaForm,
  defaultsFromSchema,
  stripEmptySecrets,
  validateSchema,
} from "@/shared/components/schema-form";
import type { JSONSchema } from "@ent-mcp/shared";

import { fetchGlobalConfig } from "../../shared/fetchers";
import { adminPluginsKeys } from "../../shared/query-keys";
import type { PluginRow } from "../../shared/types";
import { useUpdateConfig } from "../use-update-config";

interface ConfigurationTabProps {
  plugin: PluginRow;
}

export function ConfigurationTab({ plugin }: ConfigurationTabProps) {
  const schema = (plugin.manifest.globalConfigSchema ?? null) as JSONSchema | null;
  if (!schema) {
    return (
      <Card>
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle>No configuration</EmptyTitle>
            <EmptyDescription>
              {plugin.manifest.name} has no plaintext admin configuration.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }
  return <ConfigurationForm plugin={plugin} schema={schema} />;
}

// fallow-ignore-next-line complexity
function ConfigurationForm({ plugin, schema }: { plugin: PluginRow; schema: JSONSchema }) {
  const query = useQuery({
    queryKey: adminPluginsKeys.globalConfig(plugin.id),
    queryFn: async () => {
      const body = (await fetchGlobalConfig(plugin.id)) as { config: unknown };
      return body.config;
    },
  });

  const initialValues = useMemo<Record<string, unknown>>(() => {
    const base = defaultsFromSchema(schema);
    if (query.data && typeof query.data === "object") {
      return { ...base, ...(query.data as Record<string, unknown>) };
    }
    return base;
  }, [query.data, schema]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const update = useUpdateConfig(plugin.id);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const dirty = useMemo(() => !isEqual(values, initialValues), [values, initialValues]);

  const onSave = () => {
    const errors = validateSchema(schema, values);
    if (Object.keys(errors).length > 0) {
      setSubmitAttempted(true);
      return;
    }
    update.mutate(stripEmptySecrets(schema, values));
  };

  const reset = () => {
    setValues(initialValues);
    setSubmitAttempted(false);
  };

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="border-b border-border px-6 pt-5 pb-4">
        <CardTitle>Plaintext global configuration</CardTitle>
        <CardDescription>
          Server-wide settings for {plugin.manifest.name}. Secret fields stay encrypted on the
          server and are never displayed after save — leave blank to keep the existing value.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        {query.isLoading ? (
          <Skeleton className="h-32" />
        ) : query.error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
            <span>{query.error.message}</span>
          </div>
        ) : (
          <SchemaForm
            schema={schema}
            value={values}
            onChange={setValues}
            mode="edit"
            submitAttempted={submitAttempted}
          />
        )}
      </CardContent>
      <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3.5">
        <Button variant="ghost" onClick={reset} disabled={!dirty || update.isPending}>
          Discard
        </Button>
        <Button onClick={onSave} disabled={!dirty || update.isPending || query.isLoading}>
          {update.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          Save configuration
        </Button>
      </div>
    </Card>
  );
}
