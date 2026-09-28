"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The current workspace's display name, for client components.
 *
 * Resolved once per request on the server by `workspaceName()`
 * (lib/workspace-name.ts: the `general.businessName` setting, then the
 * Organization's own name, then "Bookmops" where there is no workspace) and
 * handed down from the root layout. Client components cannot ask the database
 * which company they are rendering for, which is why the sidebars, the portal
 * and the booking page all had one company's name typed into them.
 *
 * Rendered as a React text node everywhere it is used — it is an editable
 * setting, so it never goes anywhere that would treat it as markup.
 */
const WorkspaceNameContext = createContext<string>("");

export function WorkspaceNameProvider({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceNameContext.Provider value={name}>
      {children}
    </WorkspaceNameContext.Provider>
  );
}

export function useWorkspaceName(): string {
  return useContext(WorkspaceNameContext);
}
