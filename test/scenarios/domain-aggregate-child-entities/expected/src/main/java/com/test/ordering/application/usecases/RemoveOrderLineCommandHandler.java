package com.test.ordering.application.usecases;

import com.test.ordering.application.commands.RemoveOrderLineCommand;
import com.test.ordering.domain.repository.OrderRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-ORD-003]
@ApplicationComponent
public class RemoveOrderLineCommandHandler implements CommandHandler<RemoveOrderLineCommand> {

    private final OrderRepository orderRepository;

    public RemoveOrderLineCommandHandler(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(RemoveOrderLineCommand command) {
        // 1. Load Order via orderRepository.findById(...) (throws OrderNotFoundError)
        // 2. order.removeOrderLine(...)
        // 3. orderRepository.save(order)

        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
