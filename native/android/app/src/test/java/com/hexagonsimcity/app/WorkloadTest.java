package com.hexagonsimcity.app;

import static org.junit.Assert.*;
import org.junit.Test;

public final class WorkloadTest {
    @Test public void knownOutputMatchesSampleAndIsFresh() {
        byte[] input = Workload.sample();
        assertEquals(64, input.length);
        assertEquals(124, input[0] & 0xff);
        assertEquals(131, input[7] & 0xff);
        Workload.verify(input);
        input[0] = 0;
        assertEquals(124, Workload.sample()[0] & 0xff);
    }

    @Test(expected = IllegalStateException.class) public void incorrectOutputIsRejected() {
        Workload.verify(new byte[64]);
    }

    @Test(expected = IllegalStateException.class) public void incorrectShapeIsRejected() {
        Workload.verify(new byte[1]);
    }
}