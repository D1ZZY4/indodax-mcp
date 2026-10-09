import Decimal from "decimal.js";
import { formatMoney } from "@indodax-mcp/core";
import { getTicker } from "@indodax-mcp/indodax-market";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

export interface ExposureRow {
  asset: string;
  amount: string;
  valueIdr: string | null;
  price: string | null;
  pair?: string;
}

/**
 * Per-asset paper exposure valued at live prices.
 *
 * An asset whose ticker cannot be read is reported with a null value and
 * listed in `incomplete`, and is excluded from the total, rather than valued
 * at zero or at a guessed price.
 */
export async function exposureReport(app: AppServices): Promise<{
  count: number;
  exposure: ExposureRow[];
  totalIdr: string;
  incomplete: string[];
}> {
  const balances = app.paper.snapshot().balances;
  const rows: ExposureRow[] = [];
  const incomplete: string[] = [];
  let totalIdr = new Decimal(0);
  for (const [asset, amount] of Object.entries(balances)) {
    if (asset === "idr") {
      rows.push({ asset, amount, valueIdr: formatMoney(new Decimal(amount), 0), price: "1" });
      totalIdr = totalIdr.plus(new Decimal(amount));
      continue;
    }
    try {
      const ticker = await getTicker(app.publicClient, `${asset}_idr`);
      const valueIdr = new Decimal(amount).mul(new Decimal(ticker.last));
      rows.push({
        asset,
        amount,
        valueIdr: formatMoney(valueIdr, 0),
        price: ticker.last,
        pair: `${asset}_idr`,
      });
      totalIdr = totalIdr.plus(valueIdr);
    } catch {
      rows.push({ asset, amount, valueIdr: null, price: null, pair: `${asset}_idr` });
      incomplete.push(asset);
    }
  }
  return {
    count: rows.length,
    exposure: rows,
    totalIdr: formatMoney(totalIdr, 0),
    incomplete,
  };
}
