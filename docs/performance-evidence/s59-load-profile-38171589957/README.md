# Preserved failed diagnostic 38171589957

[Exact hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38171589957). Original report.json SHA-256: `15e833ab3faae704f04351c4b8ef87dc498e998636df682af8c14f358c22e01b`.

The CPU summary rejected a sample before persisting its failing scalar values. A secondary repeated stop produced an already-stopped cleanup error even though the protocol helper had already disabled and detached. Pages, browser and server closed normally. Fix 75b58356 transfers stop ownership before awaiting and preserves bounded invalid-sample evidence. The original failed report remains unchanged.
