# DiviStore-as-a-Service — GoBanq Productization Plan

**What this is:** the plan to turn the standalone DiviStore engine into a **hosted, multi-tenant service run by GoBanq**, so all of Geoff's apps/games use it as customers, and external **B2B clients** can buy or be granted access. Includes the internal APIs and the admin-panel **Customers** and **Pricing** modules.
**Companion docs:** `DIVA-STORAGE-DIVISTORE.md` (status audit + the full admin-panel module spec + the built crypto module), `DIVA-INDEX.md` (front door).
**Status:** plan / not built. The engine (storage daemon, DIVA contracts, provider agent) and the quantum-safe crypto module exist and are modular; **the service, tenancy, auth, billing, control-plane, and GoBanq-hosting layers are new work.**
**Date:** 2026-Sep-27.

---

## 1. Readiness starting point (from the audit)

Built and modular: the storage daemon (raw blob PUT/GET, localhost, no auth), the DIVA contracts (registry, provider registry, proofs, fees), the DivaNFT service, and the hybrid quantum-safe crypto module (`/Users/geoffreymccabe/diva/storage/crypto/`). **Not built:** any authenticated service API, multi-tenancy, per-customer billing, the control plane, or GoBanq wiring. This plan builds that missing layer.

## 2. Target shape

**GoBanq hosts one DiviStore Service** that sits in front of the storage nodes, the DIVA contracts, and the crypto module, and exposes two API surfaces:

- **Data plane** (apps call this): store, retrieve, status, usage. Tenant-scoped and authenticated.
- **Control plane** (the GoBanq superadmin panel and each app's own admin call this): manage customers, pricing, quotas, and view nodes/content-metadata/economics. Encryption-preserving (metadata only, never plaintext).

Everything is **modular and backend-agnostic** (same principle as the admin-panel spec): the service is a thin layer over the existing engine, so GoBanq is the host, not a rewrite.

## 3. Tenancy model (customers)

A **tenant = a customer account**. Two types:

- **Internal** — Geoff's own apps/games/products (DD69, NFD, the games, Honey Pink, etc.). Priced at **cost + ~20%** (section 5) so real money flows and the billing pipeline gets exercised.
- **External B2B** — third-party clients who buy or are granted access. Priced at a retail markup set by admin.

Each tenant record holds: `tenantId`, display name, type (internal/external), **API keys** (issue/rotate/revoke) with **scopes** (e.g. store, retrieve, admin-read), **quota/spend caps**, **price plan**, **billing currency**, usage counters, and status (active/suspended). Data and billing are **isolated per tenant**.

**Auth:** API keys per tenant for machine-to-machine calls; human access to the control plane goes through **LW-SSO** with roles (see section 7). Every privileged control-plane action is logged.

## 4. What the service meters (the cost basis)

To price anything, the service meters real resource use per tenant:

- **Bytes stored x duration** (byte-months) per tier (Standard vs Permanent).
- **Retrievals / egress bandwidth** (gateway reads).
- **Permanent-tier Arweave cost** (pass-through, when that leg is wired).
- **On-chain fees** the service pays (registry/payouts).

The service computes a **true unit cost** from provider payouts + Arweave + an infra-overhead allocation. That cost is the basis every price is built on.

## 5. Pricing model (the core of this request)

Prices are **derived from cost**, per tenant, and set in the admin Pricing module:

- **Internal tenants: price = cost x (1 + markup), markup default 20%** ("more or less" = per-tenant adjustable, e.g. 15-25%). This is a transfer-pricing mechanism: budgets flow from each app to the DiviStore/GoBanq treasury, so the billing, metering, and settlement pipeline is exercised for real without gouging our own products.
- **External B2B tenants: retail markup**, admin-set per tenant or per plan (higher than internal), with optional volume tiers.
- **USD-denominated base via oracle**, payable in multiple assets (Divi native, dUSDC, dUSDT, dBTC), per the multi-currency/multi-crypto design in the admin-panel spec. Provider payouts and customer charges can be in different assets; the treasury absorbs conversion.
- **Effective-price preview:** the admin can see, per tenant, the current cost, the markup, and the resulting price in each accepted currency before saving.

Settlement: **internal** tenants settle by internal accounting / internal transfer (still recorded as real charges so the numbers are exercised); **external** tenants settle by real payment through GoBanq.

## 6. Admin panel additions (extends the DIVA-STORAGE-DIVISTORE.md spec)

Two new modules on top of the existing Providers/Content/Proofs/Economics modules:

**Customers module.**
- List all tenants with type, status, plan, usage this period, current charges.
- Create / edit / **suspend / reactivate** a customer; set type (internal/external).
- **API keys:** issue, scope, rotate, revoke.
- **Quotas / spend caps** per tenant; alerts near limit.
- Drill-in: a customer's usage history, invoices, and key activity.
- Controls are privileged (role-gated) and logged.

**Pricing module.**
- Set the **cost basis** inputs (provider share, overhead allocation, Arweave surcharge).
- Set **markup**: the internal default (20%, adjustable), per-tenant overrides, and external/retail plans with optional volume tiers.
- Choose **accepted currencies** and per-asset settings (oracle feed, spread, minimum).
- **Preview** effective price per tenant per currency before committing.
- All changes show old vs new and are logged.

These are "assign prices and control basic customers," exactly as requested, with the internal cost+20% as the default plan for our own apps.

## 7. Internal APIs (concrete surface)

**Data plane (tenant-authenticated, apps call it):**
- `POST /v1/objects` — store (returns content hash + tier + charge estimate).
- `GET /v1/objects/{hash}` — retrieve (integrity-verified).
- `GET /v1/objects/{hash}/status` — paid/expiry/replication/tier.
- `GET /v1/usage` — this tenant's metered usage + current charges.
- (Encryption is client-side via the crypto module; the service only ever sees ciphertext.)

**Control plane (superadmin + app-admin, role-gated):**
- `GET /v1/admin/customers`, `POST /v1/admin/customers`, `PATCH /v1/admin/customers/{id}` (suspend, plan, quota), key issue/rotate/revoke.
- `GET/PUT /v1/admin/pricing` (cost basis, markups, currencies).
- `GET /v1/admin/usage?tenant=` and `/v1/admin/invoices`.
- `GET /v1/admin/nodes`, `/v1/admin/content` (metadata only, never plaintext), `/v1/admin/proofs`, `/v1/admin/economics` — the read surfaces the admin-panel modules render.
- The **GoBanq superadmin panel** is a client of this control plane; each app's own admin can be granted a scoped subset for its own tenant.

Auth: tenant API keys for the data plane; LW-SSO roles for the control plane (Viewer / Operator-admin / Economics-admin / Superadmin, as in the admin-panel spec).

## 8. Build phases

1. **Tenant model + auth** — tenant records, API keys/scopes, LW-SSO roles; wrap the storage daemon so calls are tenant-scoped and authenticated (retire the raw localhost-only interface).
2. **Metering + pricing engine** — per-tenant usage counters, the cost basis, markup (internal cost+20% default), multi-currency via oracle.
3. **Control plane API + admin Customers/Pricing modules** — build on the existing admin-panel data layer.
4. **GoBanq hosting + onboard internal apps as the first tenants** at cost+20%, so the money-flow test is live.
5. **External B2B onboarding** — retail plans, self-serve key issuance, client docs/SDK, and the sell-or-grant access flow.
6. **Package the crypto module + a client SDK** as a shared versioned dependency the apps import.

## 9. Open decisions (for Geoff)

1. **Internal markup:** confirm 20% default (and the adjustable band, e.g. 15-25%).
2. **Internal settlement:** real on-chain transfers between app treasuries, or internal ledger accounting that still records real charges? (Recommend internal ledger first, real transfers once external B2B is live.)
3. **Launch currencies:** Divi only at first, or Divi + dUSDC/dBTC immediately.
4. **Where the service runs:** confirm it lives on the GoBanq box and shares GoBanq's identity/billing.
5. **LW-SSO role mapping:** which existing roles map to Viewer / Operator-admin / Economics-admin / Superadmin.

## 10. Honest status

Nothing in this plan is built. The **foundation is real and modular** (engine + contracts + quantum-safe crypto), which makes this additive service-layer work rather than a rebuild, but the service, tenancy, billing, control plane, and GoBanq wiring are all new. This is a multi-step build, not a quick wiring job.

## 11. Cross-links
- `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-STORAGE-DIVISTORE.md` (audit + admin-panel module spec + crypto module)
- `/Users/geoffreymccabe/diva/STORAGE_PLAN.md` (engine build phases)
- `/Users/geoffreymccabe/diva/storage/crypto/` (the built quantum-safe encryption module + FORMAT.md)
- `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-INDEX.md` (front door)
