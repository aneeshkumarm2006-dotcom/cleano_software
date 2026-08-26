import { listStaff } from "@/lib/console/queries";
import { getPlatformStaff } from "@/lib/platform-db";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

import { TopBar, WarnIcon, ago } from "../ui";
import StaffRow from "./StaffRow";

export const metadata = { title: "Staff access · Awer Console" };

/**
 * Who at Awer can see across customer accounts.
 *
 * Deliberately separate from the role someone holds inside a cleaning company:
 * OWNER there means "owns this cleaning company", and one widened check would
 * have handed a customer the keys to every other customer's data.
 */
export default async function StaffPage() {
  const [staff, me] = await Promise.all([listStaff(), getPlatformStaff()]);
  const canEdit = me?.platformRole === "OWNER";
  const inactive = staff.filter((s) => !s.isActive);

  return (
    <>
      <TopBar crumbs={<b>Staff access</b>} />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>Staff access</h1>
            <p className="sub">
              People at Awer who can see across customer accounts. Separate from any role they hold
              inside a workspace.
            </p>
          </div>
        </div>

        {!canEdit && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <WarnIcon />
            <div>
              Only a platform owner can grant or remove access. You can see who has it.
            </div>
          </div>
        )}

        {inactive.length > 0 && (
          <div className="notice bad" style={{ marginBottom: 16 }}>
            <WarnIcon />
            <div>
              <b>
                {inactive.length} account{inactive.length === 1 ? "" : "s"} here {inactive.length === 1 ? "is" : "are"} deactivated but still hold platform access.
              </b>{" "}
              A deactivated account cannot sign in today, but the access should be removed rather
              than left to be re-enabled by accident.
            </div>
          </div>
        )}

        <div className="cols-2">
          <div className="stack">
            <div className="card">
              <header>
                <h2>People</h2>
                <span className="right muted">
                  {staff.length} with platform access
                </span>
              </header>
              <div className="tablewrap flush">
                <table className="mid">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Role</th>
                      <th>Can do</th>
                      <th>Last active</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty">
                          Nobody has platform access. That should be impossible — you are reading
                          this page.
                        </td>
                      </tr>
                    ) : (
                      staff.map((s) => (
                        <StaffRow
                          key={s.id}
                          id={s.id}
                          name={s.name}
                          email={s.email}
                          role={s.platformRole as "SUPPORT" | "ADMIN" | "OWNER"}
                          lastActive={ago(s.lastSeenAt)}
                          isSelf={s.id === me?.id}
                          canEdit={canEdit}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Adding someone</h2>
              </header>
              <div className="body">
                <p className="sub">
                  A new staff member gets an ordinary account in the <b>{PLATFORM_ORG_SLUG}</b>{" "}
                  workspace, then a role here. There is no invite form yet — accounts are created
                  with the seeding script, which is fine while the team is this size and stops the
                  most dangerous form in the product from being the least used one.
                </p>
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <header>
                <h2>What each role can do</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Support</dt>
                  <dd>
                    Read any workspace. Cannot change a plan, extend a trial, suspend, or touch
                    staff access.
                  </dd>
                  <dt>Admin</dt>
                  <dd>
                    Everything Support can do, plus change plans and seats, extend and restart
                    trials, suspend and reactivate.
                  </dd>
                  <dt>Owner</dt>
                  <dd>Everything Admin can do, plus grant and remove platform access.</dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Rules that always apply</h2>
              </header>
              <div className="body">
                <ul className="check">
                  <li className="done">
                    <span className="box">✓</span>Every action is written to the audit log
                  </li>
                  <li className="done">
                    <span className="box">✓</span>Each action re-checks the role for itself, not
                    just the page
                  </li>
                  <li className="done">
                    <span className="box">✓</span>Nobody can change their own access
                  </li>
                  <li className="done">
                    <span className="box">✓</span>The last owner cannot be demoted
                  </li>
                  <li className="done">
                    <span className="box">✓</span>Awer&apos;s own workspace cannot be changed from
                    here
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
