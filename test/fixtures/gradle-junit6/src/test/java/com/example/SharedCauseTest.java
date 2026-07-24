package com.example;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Twenty failures, one cause — docs/DESIGN.md §10.3.
 *
 * Every invocation dies in the same place with the same trace. Raw output repeats
 * that trace twenty times; §3.2's dedup should show it once and say how many tests
 * share it. This case alone should move the token ratio substantially.
 *
 * Doubles as the parameterized-display-name case: Gradle's `--tests` filter cannot
 * reliably select a single `[n]` invocation (§4.3), a documented limitation the
 * post-hoc under-match warning exists to surface.
 */
class SharedCauseTest {

    @ParameterizedTest(name = "row {0}")
    @ValueSource(
            ints = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20})
    void everyRowHitsTheSameBug(int row) {
        Ledger ledger = new Ledger();
        ledger.balanceFor("account-" + row);
    }

    static final class Ledger {
        private final java.util.Map<String, Double> balances = null;

        double balanceFor(String account) {
            // Always NPEs: `balances` is never initialised. One cause, twenty failures.
            return balances.getOrDefault(account, 0.0);
        }
    }
}
