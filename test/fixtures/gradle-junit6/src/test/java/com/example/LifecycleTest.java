package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Skips, errors-not-assertions, noisy stdout, and @Nested — docs/DESIGN.md §10.3.
 *
 * @Nested matters beyond output shape: Gradle's `--tests` filter has multi-year open
 * bugs selecting nested classes (§4.3), so this fixture is also the raw material for
 * the under-match warning M3 will need to prove out.
 */
class LifecycleTest {

    @Test
    @Disabled("pending the pricing rewrite — tracked in DEV-4471")
    void skippedForAKnownReason() {
        throw new AssertionError("never runs");
    }

    @Test
    @DisplayName("errors rather than asserting")
    void throwsRatherThanAsserting() {
        String config = null;
        // NPE, not an assertion failure: a different failure shape to classify.
        config.trim();
    }

    @Test
    void writesALotOfStandardOutput() {
        // Real suites log heavily. With showStandardStreams this lands in the console
        // an agent reads, and it is pure noise around a one-line failure.
        for (int i = 1; i <= 40; i++) {
            System.out.println(
                    "[pricing] evaluating rule " + i + " of 40 for tenant acme-corp (region=us-west-2)");
        }
        System.err.println("[pricing] WARN rule 37 fell through to the default branch");
        assertEquals(40, 39, "rule count drifted");
    }

    @Nested
    @DisplayName("when the cart is empty")
    class WhenCartIsEmpty {

        @Test
        void totalsToZero() {
            assertEquals(0.0, 0.0);
        }

        @Test
        void rejectsCheckout() {
            assertEquals("REJECTED", "ACCEPTED", "empty cart should not check out");
        }
    }
}
