export type TxStandbySourceIdentity = {
  id: string;
  name?: string | null;
  serial_number?: string | null;
};

export type TxStandbyAnnouncement = {
  status: "standby";
  txDevice: string;
  serialNumber: string;
};

/** Build the small control-plane message that enters Tx mode without transmitting. */
export const resolveTxStandbyAnnouncement = (
  source: TxStandbySourceIdentity,
): TxStandbyAnnouncement => ({
  status: "standby",
  txDevice: source.name?.trim() || source.id,
  serialNumber: source.serial_number?.trim() || source.id,
});
