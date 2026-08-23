# Agent007 Commercial Venture Lifecycle

## Scope

This document defines the commercial lifecycle implemented on top of the existing Agent007 Venture OS. It does not create a second CRM, payment system, or venture registry.

## Canonical flow

Customer → Customer Success lifecycle → Mission → verified artifact/outcome → succeeded Transaction → Invoice/Subscription state → Revenue attribution → Portfolio Intelligence → CEO optimization.

## Customer Success

Customer status (`lead`, `prospect`, `customer`, etc.) is not sufficient evidence of delivered value. `CustomerSuccessState` is venture-scoped and records lifecycle, activation, risk, optional measured health/satisfaction, value and renewal timestamps, next-best action, and operator ownership.

No synthetic health score is seeded. Missing measurement remains `NULL` / `UNKNOWN`.

## Portfolio Intelligence

Portfolio intelligence is sourced from relational Venture/BusinessUnit and venture-scoped commercial records. Static portfolio performance fields are not authoritative for current revenue, customer, or campaign metrics.

Tracked campaign spend is explicitly labeled as tracked spend; it is not silently presented as total operating cost.

## Mission → Money

A mission can attribute a real succeeded transaction only when the transaction exists, belongs to the same venture, has a positive amount, and is in `succeeded` state. The bridge writes canonical `TRANSACTION` and `REVENUE_RECOGNIZED` BusinessOutcome records keyed by the existing outcome ledger.

## Venture template proof

The Venture Factory continues to create structural shells. It is not certified as a reusable N-venture template until at least one real Venture has all of the following:

- relational Venture identity in `PRODUCTION` state;
- a real venture-scoped customer;
- a succeeded venture-scoped transaction;
- a paid invoice linked to that succeeded transaction;
- a customer reaching `VALUE_REALIZED` or `RETAINED`;
- a mission-to-money attribution linking a mission to a transaction;
- positive recognized revenue from that attribution.

Until those conditions exist, factory output remains structural-only and is not represented as production-proven.
