# x402 `upto` scheme — investigation & findings

Context: while testing **apify-core PR [#27039](https://github.com/apify/apify-core/pull/27039)** ("feat(agentic-payments): add x402 upto scheme support") end-to-end against the local API, we hit a series of failures with the upto scheme that turned out to be partly client-side (mcpc gaps), partly local cache state, and primarily an **upstream CDP facilitator gap**.

This document captures the full debugging journey, the on-chain proof that the apify-core code is spec-compliant, and the changes made to mcpc to make upto signing self-healing.

---

## TL;DR

- ✅ `exact` scheme works **end-to-end** on the local API (verify, settle, run, charge, refund — all confirmed on-chain on Base Sepolia).
- ✅ apify-core PR #27039's upto signing/wiring is spec-correct — proven by the official x402 reference facilitator at `x402.org`, which **accepts our payloads, verifies them, and settles them on-chain**.
- ❌ **CDP's `/verify` endpoint has a stale schema** — rejects upto-style `permit2Authorization` payloads with `'paymentPayload' is invalid: must match one of [x402V2PaymentPayload, x402V1PaymentPayload]. schema requires 'authorization', 'transaction'`. This is an upstream Coinbase issue, not anything in apify-core or mcpc.
- 🐛 Found a real bug in apify-core PR #27039: `X402Client.getAllPaymentRequirements` calls `log.error` unconditionally even when the configured kind is supported by the facilitator. Spammy logs.
- ✨ Added Permit2 allowance auto-approval to mcpc's `signUptoPayment` — when the wallet hasn't approved Permit2 yet, mcpc submits the one-time `approve(MAX_UINT256)` transaction before signing.

---

## On-chain evidence (Base Sepolia)

| Tx | Purpose | Hash |
|---|---|---|
| Initial settlement (exact, $1) | Apify wallet pulls $1 from payer at auth time | [`0x7a1ad9bcd5e412...`](https://sepolia.basescan.org/tx/0x7a1ad9bcd5e412f7793da006db9d5b990b857163e4bb2af98adbb80f7866e535) |
| Initial settlement (exact, $1) | Failed run (auth ok, run rejected) | [`0x3e441527...`](https://sepolia.basescan.org/tx/0x3e441527) |
| Initial settlement (exact, $1) | Successful run (`apify/python-example`) | [`0x712dc7154...`](https://sepolia.basescan.org/tx/0x712dc7154baca4b81f06fdfbcafca0704e5b784c832cd1b83858a3a73f857cf8) |
| Refund (exact, ~$1) × 3 | Daemon refund of unused balance | `0x965c576d...`, `0xc7c745f9...`, `0x6e7f31b5...` |
| Refund (exact, ~$0.50) | Daemon refund after $0.50 retroactive charge | [`0x968e954e5c8f...`](https://sepolia.basescan.org/tx/0x968e954e5c8fc7eca93cc7e0e8a3776d0c9b9b88b2a098f323a7e9c1ca240007) |
| **Permit2 approve (one-time)** | mcpc's auto-approve — `USDC.approve(PERMIT2, MAX_UINT256)` | (issued from the test wallet) |
| **upto settle via x402.org** | x402 reference facilitator pulls $1 via `x402UptoPermit2Proxy.settle()` | [**`0xdc8449a2f72db1...`**](https://sepolia.basescan.org/tx/0xdc8449a2f72db1abce2e2d4a06e7f4e0ecfd097e98382e5b67764edb741aee01) |

The last one is the smoking gun: it proves the apify-core PR #27039 produces an upto Permit2 witness that the official x402 facilitator accepts and settles on-chain.

---

## Test environment

- **API**: local `npm run api` from `apify/apify-core` (PR branch `feat/x402-upto-scheme`, head `deb03d8ec`)
- **Daemon**: local `npm run daemons:infinite` (settling daemon picks up finalizable payments every 2s)
- **MongoDB**: local `apify-dev` database
- **mcpc**: local build of `apify/mcp-cli` with the upto signer changes documented below
- **Network**: Base Sepolia (`eip155:84532`)
- **Test wallet**: `0xb5273f0F04Ab2e42b039F826EbA1D8E8Ab25A0A6`
- **Apify wallet**: `0xDF278412eCbE00D6381408F739eB8dA60542a0c4`
- **Test asset**: USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- **Test actor**: `apify/python-example` (had to mongo-patch its `actorPermissionLevel` from `FULL_PERMISSIONS` → `LIMITED_PERMISSIONS` and add a PAY_PER_EVENT `pricingInfos` entry to satisfy the agentic-payments preconditions)

---

## Path 1 — `exact` scheme (works end-to-end)

1. `POST /v2/acts/apify~python-example/run-sync` with no auth → API returns `402 Payment Required` with both `upto` and `exact` accepts.
2. `mcpc x402 sign --scheme exact <PAYMENT-REQUIRED>` → produces a valid EIP-3009 `TransferWithAuthorization` signature.
3. POST again with `PAYMENT-SIGNATURE` header → API authenticates the payment, settles $1 on-chain (real CDP facilitator), creates the agentic payment record, runs the actor.
4. Run produces a result; we then retroactively bumped `chargedEventCounts.test-event += 50` and `agenticPayments.remainingBalanceUsd -= 0.5` to simulate $0.50 of usage.
5. We forced `expiresAt` to a past date on all unfinalized payments → settling daemon picks them up → `finalizeExactPayment` issues on-chain refunds for the unused balance (minus gas) → all 4 payments finalized within 10s, all refunds confirmed on-chain.

Conclusion: the entire `exact` flow works on Base Sepolia against the live CDP facilitator.

---

## Path 2 — `upto` scheme (blocked by CDP)

### Round 1: API → CDP `/verify` returns 401 unauthorized

Sign with `mcpc x402 sign --scheme upto …` → POST to API → API responds:

```json
{"error":{"type":"x402-agentic-payment-unauthorized","message":"The provided payment payload is invalid or could not be verified by the facilitator."}}
```

The X402Client just throws on `isValid: false` and discards the underlying `invalidReason` — so the error is opaque from the API logs alone. We needed to talk to the facilitator directly to see the real reason.

### Direct verify against CDP

We wrote a helper script (`/tmp/verify-upto.sh` + `/tmp/verify-upto.mjs`) that mirrors the CDPFacilitator JWT auth and posts our signed payload + paymentRequirements to `https://api.cdp.coinbase.com/platform/v2/x402/verify`.

The actual CDP error:

```json
{
  "errorType": "invalid_request",
  "errorMessage": "'paymentPayload' is invalid: must match one of [x402V2PaymentPayload, x402V1PaymentPayload]. schema requires 'authorization', 'transaction'",
  "correlationId": "9f36ab0ecc71e68c-IAD"
}
```

CDP's schema validator only accepts `payload.authorization` (EIP-3009 / exact) or `payload.transaction` (likely Solana). It does NOT recognize `payload.permit2Authorization` (upto) — even though `/supported` advertises upto kinds for `eip155:84532`, `eip155:8453`, `eip155:137`, `eip155:42161`, etc.

### Confirmation against the official x402 reference facilitator

We POSTed the same payload (witness rebound to x402.org's facilitator address) to `https://www.x402.org/facilitator/verify`:

```json
{"isValid": true, "payer": "0xb5273f0F04Ab2e42b039F826EbA1D8E8Ab25A0A6"}
```

…and then the actual `/settle` call:

```json
{
  "success": true,
  "transaction": "0xdc8449a2f72db1abce2e2d4a06e7f4e0ecfd097e98382e5b67764edb741aee01",
  "network": "eip155:84532",
  "payer": "0xb5273f0F04Ab2e42b039F826EbA1D8E8Ab25A0A6",
  "amount": "1000000"
}
```

→ Real USDC moved on-chain via `x402UptoPermit2Proxy.settle()`. Our payload structure is spec-correct; CDP just hasn't updated their `/verify` schema validator to accept the upto variant yet.

The official x402 v2 schema in [`typescript/packages/core/src/schemas/index.ts`](https://github.com/coinbase/x402/blob/main/typescript/packages/core/src/schemas/index.ts) confirms it:

```ts
export const PaymentPayloadV2Schema = z.object({
  x402Version: z.literal(2),
  resource: ResourceInfoSchema.optional(),
  accepted: PaymentRequirementsV2Schema,
  payload: Any,                  // ← Any! Spec accepts permit2Authorization here.
  extensions: OptionalAny,
});
```

CDP is enforcing a tighter, older schema that pre-dates the Permit2 upto branch.

### Side effect — CDP returns rotating facilitator addresses

CDP load-balances `/supported` responses across multiple signers. For `eip155:84532` upto we observed three different `extra.facilitatorAddress` values on three calls (`0x97AcCe…`, `0xa32cCda…`, `0x67B9CE…`). All five eip155 signers from CDP's `signers["eip155:*"]` array eventually rotate through.

This isn't broken behavior — each signed payload binds to whichever address the API received from `/supported` at the moment of signing, and CDP can route the verify/settle to the matching signer. But it did initially make us suspect the API's memoize cache was stale. Worth being aware of for anyone debugging similar issues.

---

## Bug found in apify-core PR #27039: unconditional `log.error`

In `src/packages/agentic-payments/src/x402/x402_client.ts` (added in commit `38b3e028`):

```ts
async getAllPaymentRequirements(): Promise<X402PaymentRequirements[]> {
  const supportedKinds = await this.memoizedGetSupportedKinds();
  const paymentRequirements: X402PaymentRequirements[] = [];

  try {
    await Promise.all(this.accepts.map(async (acceptedKind) => {
      const supportedKind = supportedKinds.find(...);
      if (supportedKind) {
        paymentRequirements.push(this.buildRequirements({ ... }));
      }

      log.error('Configured accept is not supported by the facilitator; skipping.', { ... });
      // ↑ Always runs — should be inside an else or guarded
    }));
  }
  ...
}
```

The docstring says *"Configured payment kinds the facilitator can't handle are logged and skipped."* — which is the **intent**. The implementation just doesn't match: it logs unconditionally.

**Real-world proof**: every 402 the local API generated logged this error twice (once per scheme), even though the 402 response correctly listed both schemes in `accepts[]`.

**Severity**:
- 🟡 Functional impact: none (paymentRequirements still populated correctly)
- 🔴 Operational impact: every 402 generates 1 false error log per configured accept; pollutes Sentry/error dashboards
- 🔴 Misleading future devs investigating "facilitator not supported" issues

**Fix**:
```ts
if (supportedKind) {
  paymentRequirements.push(this.buildRequirements({ ... }));
  return;
}
log.warning('Configured accept is not supported by the facilitator; skipping.', { ... });
```

Also recommend changing `log.error` → `log.warning` since skipping a single kind while others remain valid isn't an error — the request is still served. The "no kinds usable at all" case already has its own `log.error` at the bottom of the function.

---

## mcpc changes (added during this investigation)

Branch state: `feat/x402-upto-scheme` (local-only, not pushed).

### `src/lib/x402/signer.ts`

1. **Refactored** the original single `signPayment` into:
   - `signExactPayment` — existing EIP-3009 logic
   - `signUptoPayment` — new Permit2 `permitWitnessTransferFrom` logic
   - `signPayment` — delegates by `accept.scheme`

2. **Added** `selectAcceptEntry(accepts, preference)` — picks a valid accept entry from a 402 response based on preference (`auto` prefers upto then exact, `upto`/`exact` force one).

3. **Added** Permit2 allowance auto-approval in `signUptoPayment`:
   - Reads `USDC.allowance(wallet, PERMIT2)` via JSON-RPC
   - If allowance < required amount, sends a one-time `USDC.approve(PERMIT2, MAX_UINT256)` transaction and waits for receipt
   - Skipped via `SignPaymentInput.skipPermit2Approval = true`
   - Network is automatically derived from `accept.network` — works on Base Mainnet (`eip155:8453`) and Base Sepolia (`eip155:84532`) without user intervention

### `src/cli/commands/x402.ts`

- Added `--scheme <auto|upto|exact>` flag on `mcpc x402 sign` (default: `auto`)
- Added `--no-approve` flag to skip Permit2 allowance auto-approval (advanced/testing)
- Help text updated

### `test/unit/lib/x402/signer.test.ts`

- 30 unit tests, all passing:
  - 10 for `selectAcceptEntry` and `parsePaymentRequired` scheme preference
  - 15 for `signPayment` exact + upto payload shape, amount/expiry overrides, error cases
  - 5 for the new Permit2 allowance auto-approval flow (skip when sufficient, approve when short, throw on revert, skip via `skipPermit2Approval`, exact scheme doesn't probe allowance)

### Known gap (separate, easy fix)

`mcpc x402 info` is hard-coded to Base Mainnet RPC, so it always shows mainnet balances regardless of which network you're testing on. We hit this when the wallet's mainnet ETH balance was reported but Sepolia was empty, causing the first auto-approve to fail with `gas required exceeds allowance (0)`. Funded the wallet via [Coinbase Sepolia faucet](https://portal.cdp.coinbase.com/products/faucet); next sign produced a successful approve tx and went on to settle.

---

## Settings preconditions (for any future tester)

To get an actor through the full agentic-payment pipeline locally, the actor needs:
1. `actorPermissionLevel: 'LIMITED_PERMISSIONS'` (not `FULL_PERMISSIONS`)
2. A `pricingInfos` array with at least one `pricingModel: 'PAY_PER_EVENT'` entry where `isPPEPlatformUsagePaidByUser` is not `true`

Quick mongo patch:
```js
db.acts2.updateOne({_id: 'fkhQSv5AmEAgVtMjy'}, {
  $set: {
    actorPermissionLevel: 'LIMITED_PERMISSIONS',
    pricingInfos: [{
      createdAt: new Date(),
      startedAt: new Date('2025-01-01'),
      apifyMarginPercentage: 0.2,
      pricingModel: 'PAY_PER_EVENT',
      pricingPerEvent: {
        actorChargeEvents: {
          'test-event': {
            eventTitle: 'Test event',
            eventDescription: 'Test event for agentic payments',
            eventPriceUsd: 0.01,
            isPrimaryEvent: true,
          },
        },
      },
      minimalMaxTotalChargeUsd: 1,
    }],
  },
});
```

The agentic-payments check is enforced in `src/packages/agentic-payments/src/utils.ts` — `ensureActorIsAllowedForAgenticPayments`.

---

## Recommendations for PR #27039

In rough order of priority:

1. **Fix the `log.error` bug** (small, separate commit). It's spamming logs per 402 response.
2. **Decide on the upto-with-CDP situation** — three options:
   - **Ship as-is**, document the CDP limitation, monitor for upstream fix. The upto code is correct, it just won't authenticate end-to-end against CDP today.
   - **Disable upto in prod settings** (`settings.prod.json` / `settings.staging.json`) until CDP fixes the schema. Keep upto in dev/test settings so testing continues.
   - **Switch facilitator from CDP → x402.org** (or run a self-hosted x402 facilitator). This unblocks upto end-to-end today, but adds operational surface area.
3. **Report the CDP issue** to Coinbase. Reproducer is in this doc; correlation IDs from our verify attempts are stored above.
4. **Earlier review notes** still relevant before merge:
   - Cap `usageInAssetUnits` in `finalizeUptoPayment` against the original Permit2 authorized amount, to prevent on-chain revert from rounding drift.
   - Add retry budget / terminal-state handling for upto settlement failures, otherwise the daemon retries forever and grows the `transactions[]` array unboundedly.
   - Verify the `X402_WALLET_PRIVATE_KEY` in each environment derives to the previously-hardcoded `apifyWalletAddress` — that explicit address check is gone in the PR.

---

## Direct-verify helper script (kept under `/tmp` — not in the repo)

For future debugging of CDP rejections:

- `/tmp/verify-upto.sh` — bash wrapper that prompts for the four inputs (PAYMENT-REQUIRED, PAYMENT-SIGNATURE, CDP key id, CDP key secret) using `read -s`
- `/tmp/verify-upto.mjs` — Node ESM script that mirrors `CDPFacilitator`'s JWT auth (`jose` Ed25519) and posts to `/verify` and `/supported`, printing the full response (including `invalidReason`)

The Node script imports `jose` by absolute path from apify-core's `node_modules` so it runs without installing anything in `/tmp`.
