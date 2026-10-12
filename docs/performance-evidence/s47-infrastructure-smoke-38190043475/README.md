# Infrastructure producer and validator contract mismatch

[Run 38190043475](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38190043475) at `b3f4386e290524b221ac8ea4270c2ba8cc475205` completes four capture samples but fails the outer validator because workload.providerFixture is absent. The retained report reveals further disagreement: infrastructure intentionally keeps one measured application document for its four samples, while the validator and its synthetic fixtures assumed a new document for each sample. Diagnostics record startup-1 and main-setup; worker audits record startup-1 and the misleading provider-sample-0 name. There are two validated worker observations.

The shared comparison-readiness check also reports incomplete diagnostic coverage because it expects the dense fixture's document lifecycle. Repair the producer, ownership names, validator, shared readiness checks and producer-derived regression coverage together. Merely lowering an audit count is insufficient.

The new failure envelope successfully preserves a bounded, redacted projection of the completed capture. It explicitly marks truncation: some nested condition and contract fields are omitted, so this projection supports diagnosis but cannot independently revalidate the complete original capture. The report remains failed.

This is a short SwiftShader diagnostic with no hardware or performance acceptance.
