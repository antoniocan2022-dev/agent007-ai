# Revenue Execution Notes

Execution lifecycle: prepare -> approve -> execute -> verify.

The executor registry is closed-world and currently disabled for all four capability slots. This is intentional until each adapter has explicit authorization, idempotency, response validation, and audit evidence.
