/**
 * The Philippines shops of one business. They are declared in the environment (server side only):
 * PANCAKE_SHOP_ID_PHIL, PANCAKE_SHOP_ID_PHIL2, ... and the optional PANCAKE_PHP_SHOP_IDS (comma separated).
 *
 * - Whatever currency the POS gives such a shop, the app treats it as a peso shop (`listShops` in sync.ts).
 * - Hand-entered costs and rates are kept once for the whole group, under the id of the main shop (`costShopId`), so they are typed
 *   in once and read the same whichever of the shops is opened.
 * - Rates (cost of goods per kind, per-order costs) apply to each shop's own orders, so every shop uses them. Amounts (costs typed
 *   in, the accountant's daily sheet) are the business's own totals: only the main shop books them (`carriesSharedCosts`), so a
 *   report that adds the shops together counts them once, like the Meta ad spend.
 */
type Env = Record<string, string | undefined>;

/** The ids of the declared Philippines shops. */
export function declaredPhShopIds(env: Env = process.env) {
  const ids = new Set<number>();
  for (const [name, value] of Object.entries(env)) {
    if (!/^PANCAKE_SHOP_ID_PHIL\d*$/.test(name) && name !== "PANCAKE_PHP_SHOP_IDS") continue;
    for (const part of (value ?? "").split(",")) {
      const id = Number(part.trim());
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return ids;
}

/** The main Philippines shop: PANCAKE_SHOP_ID_PHIL when it is declared, else the lowest declared id. */
export function mainPhShopId(env: Env = process.env) {
  const ids = Array.from(declaredPhShopIds(env)).sort((a, b) => a - b);
  const preferred = Number(env.PANCAKE_SHOP_ID_PHIL);
  return ids.includes(preferred) ? preferred : ids[0];
}

/** Every Philippines shop that shares its costs with `shopId` (just `[shopId]` for any other shop, or when there is only one). */
export function phShopGroup(shopId: number, env: Env = process.env) {
  const ids = declaredPhShopIds(env);
  return ids.size > 1 && ids.has(shopId) ? Array.from(ids).sort((a, b) => a - b) : [shopId];
}

/** The shop id costs and rates of `shopId` are stored under: the main shop's for a Philippines shop of a group, else its own. */
export function costShopId(shopId: number, env: Env = process.env) {
  return phShopGroup(shopId, env).length > 1 ? (mainPhShopId(env) as number) : shopId;
}

/**
 * The Philippines shops whose cost of goods is the cost of each product in the POS (PANCAKE_POS_COST_SHOP_IDS, comma separated), not the
 * average cost per kind of goods typed on the cost page. The shop's orders carry real products with their own cost price in the POS.
 */
export function posCostShopIds(env: Env = process.env) {
  const ids = new Set<number>();
  for (const part of (env.PANCAKE_POS_COST_SHOP_IDS ?? "").split(",")) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/** True for a shop whose cost of goods comes from the product costs of the POS (see posCostShopIds). */
export function usesPosCost(shopId: number, env: Env = process.env) {
  return posCostShopIds(env).has(shopId);
}

/** False for a Philippines shop of a group that is not the main one: its report leaves the shared amounts to the main shop. */
export function carriesSharedCosts(shopId: number, env: Env = process.env) {
  return costShopId(shopId, env) === shopId;
}
