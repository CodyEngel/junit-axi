package com.example;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * AssertJ multi-line diffs — docs/DESIGN.md §10.3.
 *
 * These are the cases where the expected/actual diff is the entire useful payload.
 * Blind character-count truncation would cut the diff in half and destroy the only
 * part an agent needs; §3.2's compression has to preserve it and prune around it.
 */
class AssertionDiffTest {

    @Test
    void comparesLists() {
        List<String> actual = List.of("alpha", "bravo", "delta", "echo");
        List<String> expected = List.of("alpha", "bravo", "charlie", "delta");
        assertThat(actual).containsExactlyElementsOf(expected);
    }

    @Test
    void comparesMaps() {
        // LinkedHashMap, deliberately, NOT Map.of: the immutable factories randomize
        // iteration order per JVM run, which makes AssertJ's rendered diff differ
        // between runs and the snapshot flaky. Fixtures must be deterministic.
        Map<String, Integer> actual = new LinkedHashMap<>();
        actual.put("apples", 3);
        actual.put("pears", 7);
        actual.put("plums", 2);

        Map<String, Integer> expected = new LinkedHashMap<>();
        expected.put("apples", 3);
        expected.put("pears", 9);
        expected.put("quinces", 1);

        assertThat(actual).containsExactlyInAnyOrderEntriesOf(expected);
    }

    @Test
    void comparesMultiLineStrings() {
        String actual = String.join("\n", "line one", "line two", "line three modified", "line four");
        String expected = String.join("\n", "line one", "line two", "line three", "line four");
        assertThat(actual).isEqualTo(expected);
    }

    @Test
    void comparesObjectsFieldByField() {
        Order actual = new Order("A-1001", 3, 29.97, "PENDING");
        Order expected = new Order("A-1001", 3, 34.47, "APPROVED");
        assertThat(actual).usingRecursiveComparison().isEqualTo(expected);
    }

    record Order(String id, int quantity, double total, String status) {}
}
