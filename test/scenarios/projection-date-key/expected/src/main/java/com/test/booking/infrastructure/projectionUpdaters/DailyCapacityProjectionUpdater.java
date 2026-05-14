package com.test.booking.infrastructure.projectionUpdaters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.test.booking.infrastructure.persistence.projections.DailyCapacityJpa;
import com.test.booking.infrastructure.persistence.projections.DailyCapacityJpaRepository;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persistent projection updater for DailyCapacity.
 * Subscribes to calendar.slot-capacity-published and upserts the local read model.
 * derived_from: bc.booking.projections[DailyCapacity] (persistent: true)
 * upsertStrategy: lastWriteWins
 */
@Component("booking.DailyCapacityProjectionUpdater")
public class DailyCapacityProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(DailyCapacityProjectionUpdater.class);

    private final DailyCapacityJpaRepository repository;
    private final ObjectMapper objectMapper;

    public DailyCapacityProjectionUpdater(DailyCapacityJpaRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.booking-projection-daily-capacity-slot-capacity-published}")
    @Transactional
    public void handle(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {}
            );
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error in projection updater — sending to DLQ: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, false);
            return;
        }

        try {
            Map<String, Object> data = event.data();
            LocalDate key = objectMapper.convertValue(data.get("date"), LocalDate.class);
            if (key == null) {
                log.warn("Projection event for DailyCapacity missing keyBy field date — discarding");
                channel.basicAck(deliveryTag, false);
                return;
            }

            Optional<DailyCapacityJpa> existing = repository.findById(key);

            DailyCapacityJpa row = existing.orElseGet(DailyCapacityJpa::new);
            row.setDate(key);
            row.setTotalSlots(objectMapper.convertValue(data.get("totalSlots"), Integer.class));
            row.setBookedSlots(objectMapper.convertValue(data.get("bookedSlots"), Integer.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            channel.basicAck(deliveryTag, false);
        } catch (RuntimeException e) {
            log.warn(
                "Projection updater error — will retry. queue={}, error={}",
                message.getMessageProperties().getConsumerQueue(),
                e.getMessage(),
                e
            );
            throw e;
        }
    }
}
