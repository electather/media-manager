import { useQuery } from "@tanstack/react-query";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/ui/combobox";

import { api } from "@/shared/lib/api";

interface PickerProps {
  value: string | undefined;
  onChange: (value: string) => void;
}

export function UserPicker({ value, onChange }: PickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", "list"],
    queryFn: async () => {
      const res = await api.admin.users.$get();
      if (!res.ok) throw new Error("Failed to fetch users");
      const json = await res.json();
      return json.users;
    },
  });

  const users = data ?? [];
  const selectedUser = users.find((u) => u.id === value);

  return (
    <Combobox
      items={users}
      itemToStringLabel={(user) => user.name || user.email}
      value={selectedUser ?? null}
      onValueChange={(user) => {
        if (user) onChange(user.id);
      }}
    >
      <ComboboxInput placeholder="Select user..." />
      <ComboboxContent>
        <ComboboxEmpty>{isLoading ? "Loading..." : "No user found."}</ComboboxEmpty>
        <ComboboxList>
          {(user) => (
            <ComboboxItem key={user.id} value={user}>
              <div className="flex flex-col min-w-0 text-left">
                <span className="truncate">{user.name || user.email}</span>
                {user.name && (
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                )}
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function ConnectionPicker({ value, onChange }: PickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "connections", "list"],
    queryFn: async () => {
      const res = await api.connections.$get();
      if (!res.ok) throw new Error("failed to fetch connections");
      const { connections } = await res.json();
      return connections ?? [];
    },
  });

  const connections = data ?? [];
  const selectedConnection = connections.find((c) => c.id === value);

  return (
    <Combobox
      items={connections}
      itemToStringLabel={(conn) => conn.displayName || conn.pluginId}
      value={selectedConnection ?? null}
      onValueChange={(conn) => {
        if (conn) onChange(conn.id);
      }}
    >
      <ComboboxInput placeholder="Select connection..." />
      <ComboboxContent>
        <ComboboxEmpty>{isLoading ? "Loading..." : "No connection found."}</ComboboxEmpty>
        <ComboboxList>
          {(conn) => (
            <ComboboxItem key={conn.id} value={conn}>
              <div className="flex flex-col min-w-0 text-left">
                <span className="truncate">{conn.displayName || conn.pluginId}</span>
                <span className="truncate text-xs text-muted-foreground">{conn.id}</span>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
