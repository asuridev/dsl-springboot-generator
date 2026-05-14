package com.test.booking.application.dtos;

import java.time.LocalDate;

/**
 * Local read model of daily slot capacity keyed by calendar date.
 */

// derived_from: projection:DailyCapacity

public record DailyCapacity(LocalDate date, Integer totalSlots, Integer bookedSlots) {}
