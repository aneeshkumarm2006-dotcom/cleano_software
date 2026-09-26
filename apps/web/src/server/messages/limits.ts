// Team chat's own limit (API_V1.md §4): a send or an edit fans out to every
// member of the channel. Shared by the send and edit routes, so an edit spree
// and a send spree count against the same budget.
export const TEAM_CHAT_SEND_LIMIT = { name: "team-chat-send", max: 20, windowMs: 60_000 };

/** API_V1.md §4: an office chat send emails the office when no one is online. */
export const OFFICE_CHAT_SEND_LIMIT = { name: "office-chat-send", max: 10, windowMs: 60_000 };
