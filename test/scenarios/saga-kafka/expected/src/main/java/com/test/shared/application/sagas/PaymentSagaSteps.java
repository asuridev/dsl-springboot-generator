package com.test.shared.application.sagas;

/**
 * PaymentSaga — choreographed saga descriptor.
 *
 * derived_from: system.yaml#/sagas[PaymentSaga]
 * style: choreography
 *
 * Coordinates payment processing after an order is placed.
 *
 * Trigger: {@code OrderPlaced} (bc: {@code orders}).
 *
 * Steps (in order):
 * <ul>
 *   <li>#1 {@code payments} reacts to {@code OrderPlaced} → emits {@code PaymentApproved} (failure: {@code PaymentFailed})</li>
 * </ul>
 *
 * This class is generated and is intentionally side-effect free. It exposes the
 * saga name and event constants so other components (handlers, tracing, tests)
 * can reference the saga without hard-coding string literals.
 */
public final class PaymentSagaSteps {

    private PaymentSagaSteps() {
        // constants holder
    }

    /** Saga name as declared in {@code system.yaml#/sagas}. */
    public static final String NAME = "PaymentSaga";

    /** Event that triggers the saga. */
    public static final String TRIGGER_EVENT = "OrderPlaced";

    /** Bounded context that publishes the trigger event. */
    public static final String TRIGGER_BC = "orders";

    // ── Step events ─────────────────────────────────────────────────────────

    /** Step 1 — handled by {@code payments}. */
    public static final int STEP_1_ORDER = 1;
    public static final String STEP_1_BC = "payments";
    public static final String STEP_1_TRIGGERED_BY = "OrderPlaced";
    public static final String STEP_1_SUCCESS = "PaymentApproved";
    public static final String STEP_1_FAILURE = "PaymentFailed";

}
