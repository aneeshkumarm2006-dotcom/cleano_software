import Link from "next/link";

import { TopBar } from "./ui";

/**
 * A console-shaped 404, so a mistyped workspace address does not drop an
 * operator into the customer-facing not-found page.
 */
export default function ConsoleNotFound() {
  return (
    <>
      <TopBar crumbs={<b>Not found</b>} />
      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>No such workspace</h1>
            <p className="sub">
              Nothing on Awer answers to that address. It may have been renamed, or the link may be
              older than the workspace.
            </p>
          </div>
        </div>
        <Link className="btn primary" href="/console/workspaces">
          All workspaces
        </Link>
      </div>
    </>
  );
}
