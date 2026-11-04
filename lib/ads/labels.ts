/** MySQL access for the ad account labels (table `ads_account_labels`, see database/schema.sql). Server-side only. */
import { withDb, type Db } from "@/lib/costs/db";
import type { AdsAccountLabel, AdsMarket } from "./label-types";

export * from "./label-types";

function toLabel(row: Record<string, unknown>): AdsAccountLabel {
  const channel = String(row.channel ?? "");
  return {
    accountId: String(row.account_id),
    market: String(row.market) as AdsMarket,
    channel: channel === "zalo" || channel === "page" ? channel : null,
  };
}

export function listLabels(db?: Db) {
  return withDb(db, async (conn) => {
    const { rows } = await conn.query("SELECT account_id, market, channel FROM ads_account_labels ORDER BY market, account_id");
    return rows.map(toLabel);
  });
}

/** Makes the stored labels exactly `labels` (the editor always sends the whole picture), all or nothing. */
export function replaceLabels(labels: AdsAccountLabel[], updatedBy: string | null, db?: Db) {
  return withDb(db, (conn) =>
    conn.transaction(async (tx) => {
      await tx.query("DELETE FROM ads_account_labels");
      for (const label of labels) {
        await tx.query("INSERT INTO ads_account_labels (account_id, market, channel, updated_by) VALUES (?, ?, ?, ?)", [
          label.accountId,
          label.market,
          label.channel ?? "",
          updatedBy,
        ]);
      }
      const { rows } = await tx.query("SELECT account_id, market, channel FROM ads_account_labels ORDER BY market, account_id");
      return rows.map(toLabel);
    }),
  );
}
