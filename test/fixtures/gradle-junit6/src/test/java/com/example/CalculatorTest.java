package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/**
 * Minimal fixture: one pass, one fail. Enough to prove the capture pipe
 * reproduces identically twice before the adversarial catalog goes in.
 */
class CalculatorTest {

    @Test
    void addsTwoNumbers() {
        assertEquals(4, 2 + 2);
    }

    @Test
    void appliesTax() {
        assertEquals(10.80, 9.00 * 1.1, 0.001, "tax calculation drifted");
    }
}
