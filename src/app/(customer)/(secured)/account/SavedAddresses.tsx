"use client";

/**
 * Customer portal mount of the shared saved-address book (awerfixes.pdf item 2,
 * round 3, stage 4). Replaces the single "Default address" textbox, which wrote
 * the flat `Client.address` scalar that every web booking overwrote.
 *
 * Same component the admin client page renders; only the actions differ — these
 * resolve the client from the session, so nothing here takes a clientId.
 */

import SavedAddressManager from "@/components/addresses/SavedAddressManager";
import type { SavedAddress } from "@/lib/client-address";
import {
  addMyAddress,
  updateMyAddress,
  deleteMyAddress,
} from "../../actions/clientAddresses";

export default function SavedAddresses({
  addresses,
}: {
  addresses: SavedAddress[];
}) {
  return (
    <div className="cl-tile cl-tile-pad-lg cl-stack-16">
      <div>
        <h2 className="cl-tile-title">Saved addresses</h2>
        <p className="cl-subtitle" style={{ marginTop: 4 }}>
          Pick any of these when you book. Your default is offered first.
        </p>
      </div>
      <SavedAddressManager
        addresses={addresses}
        onAdd={addMyAddress}
        onUpdate={updateMyAddress}
        onDelete={deleteMyAddress}
        emptyText="No saved addresses yet — add one and it'll be ready next time you book."
        accessNotesHint="Buzzer, gate code, parking — only your assigned cleaner sees this."
      />
    </div>
  );
}
