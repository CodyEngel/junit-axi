package com.example;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * `Caused by:` chains and deep framework noise — docs/DESIGN.md §10.3.
 *
 * Nested causes are among the largest token sinks in JVM output: each link repeats
 * a full trace, most of it framework and JDK frames an agent has no use for. This
 * is the highest-leverage case for §3.2's project-frame pruning.
 */
class CausalChainTest {

    @Test
    void failsWithNestedCauses() {
        loadOrderBook();
    }

    @Test
    void failsThroughLambdaFrames() {
        // Streams and lambdas bury the project frame under java.base internals.
        List.of("1", "2", "not-a-number", "4").stream().map(Integer::parseInt).toList();
    }

    private void loadOrderBook() {
        try {
            readSettlementFile();
        } catch (Exception e) {
            throw new IllegalStateException("could not load order book for session 2026-07-23", e);
        }
    }

    private void readSettlementFile() throws Exception {
        try {
            parseSettlementRow("A-1001,3,not-a-number,PENDING");
        } catch (Exception e) {
            throw new java.io.IOException("settlement file corrupt at row 1", e);
        }
    }

    private void parseSettlementRow(String row) {
        String[] parts = row.split(",");
        Double.parseDouble(parts[2]);
    }
}
