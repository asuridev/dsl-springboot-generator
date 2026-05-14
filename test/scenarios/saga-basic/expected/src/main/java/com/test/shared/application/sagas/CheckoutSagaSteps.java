package com.test.shared.application.sagas;

/**
 * CheckoutSaga — choreographed saga descriptor.
 *
 * derived_from: system.yaml#/sagas[CheckoutSaga]
 * style: choreography
 *
 * Coordinates stock reservation after an order is placed.
 *
 * Trigger: {@code OrderPlaced} (bc: {@code orders}).
 *
 * Steps (in order):
 * <ul>
 *   <li>#1 {@code inventory} reacts to {@code OrderPlaced} → emits {@code StockReserved} (failure: {@code StockReservationFailed})</li>
 * </ul>
 *
 * This class is generated and is intentionally side-effect free. It exposes the
 * saga name and event constants so other components (handlers, tracing, tests)
 * can reference the saga without hard-coding string literals.
 */
public final class CheckoutSagaSteps {

    private CheckoutSagaSteps() {
        // constants holder
    }

    /** Saga name as declared in {@code system.yaml#/sagas}. */
    public static final String NAME = "CheckoutSaga";

    /** Event that triggers the saga. */
    public static final String TRIGGER_EVENT = "OrderPlaced";

    /** Bounded context that publishes the trigger event. */
    public static final String TRIGGER_BC = "orders";

    // ── Step events ─────────────────────────────────────────────────────────

    /** Step 1 — handled by {@code inventory}. */
    public static final int STEP_1_ORDER = 1;
    public static final String STEP_1_BC = "inventory";
    public static final String STEP_1_TRIGGERED_BY = "OrderPlaced";
    public static final String STEP_1_SUCCESS = "StockReserved";
    public static final String STEP_1_FAILURE = "StockReservationFailed";

}
