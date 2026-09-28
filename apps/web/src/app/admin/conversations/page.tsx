import { Bot } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * The right-hand pane with nothing open yet.
 *
 * The guard and the query both live in the layout now, because the list has to
 * render whether or not a thread is chosen — this file only has to say what
 * fills the space until one is.
 */
export default function ConversationsIndex() {
  return (
    <div className="cv-blank">
      <div className="cv-blank-mark" aria-hidden="true">
        <Bot size={26} />
      </div>
      <p className="cv-blank-h">Pick a conversation</p>
      <p className="cv-blank-s">
        Texts and emails the assistant answered. Anyone waiting on a person is
        at the top of the list, and you can filter to just those.
      </p>
    </div>
  );
}
