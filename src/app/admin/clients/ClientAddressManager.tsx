"use client";

/**
 * Admin mount of the shared saved-address book. The UI itself lives in
 * components/addresses/SavedAddressManager so the customer portal can render
 * the same thing with its own session-scoped actions (awerfixes.pdf item 2,
 * round 3, stage 4).
 */

import SavedAddressManager from "@/components/addresses/SavedAddressManager";
import type { SavedAddress } from "@/lib/client-address";
import {
  addClientAddress,
  updateClientAddress,
  deleteClientAddress,
} from "../actions/clientAddresses";

interface Props {
  clientId: string;
  addresses: SavedAddress[];
}

export default function ClientAddressManager({ clientId, addresses }: Props) {
  return (
    <SavedAddressManager
      addresses={addresses}
      extraFields={{ clientId }}
      onAdd={addClientAddress}
      onUpdate={updateClientAddress}
      onDelete={deleteClientAddress}
    />
  );
}
