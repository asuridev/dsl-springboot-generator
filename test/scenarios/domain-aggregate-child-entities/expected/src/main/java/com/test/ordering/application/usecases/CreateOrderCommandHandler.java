package com.test.ordering.application.usecases;

import com.test.ordering.application.commands.CreateOrderCommand;
import com.test.ordering.domain.repository.OrderRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-ORD-001]
@ApplicationComponent
public class CreateOrderCommandHandler implements ReturningCommandHandler<CreateOrderCommand, UUID> {

    private final OrderRepository orderRepository;

    public CreateOrderCommandHandler(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateOrderCommand command) {
        // 1. Build the Order aggregate (Order.create(...) / new Order(...))
        // 2. orderRepository.save(order)

        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
