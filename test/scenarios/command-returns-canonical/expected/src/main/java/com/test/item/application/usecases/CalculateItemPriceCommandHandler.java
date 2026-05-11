package com.test.item.application.usecases;

import com.test.item.application.commands.CalculateItemPriceCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.math.BigDecimal;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[calculate-item-price]
@ApplicationComponent
public class CalculateItemPriceCommandHandler
    implements ReturningCommandHandler<CalculateItemPriceCommand, BigDecimal>
{

    @Override
    @Transactional
    @LogExceptions
    public BigDecimal handle(CalculateItemPriceCommand command) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
