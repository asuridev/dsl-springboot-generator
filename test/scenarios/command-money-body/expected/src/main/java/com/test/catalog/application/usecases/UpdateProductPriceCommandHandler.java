package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.UpdateProductPriceCommand;
import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.errors.ProductNotFoundError;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.catalog.domain.valueobject.Money;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-002]
@ApplicationComponent
public class UpdateProductPriceCommandHandler implements CommandHandler<UpdateProductPriceCommand> {

    private final ProductRepository productRepository;

    public UpdateProductPriceCommandHandler(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(UpdateProductPriceCommand command) {
        Product product = productRepository
            .findById(UUID.fromString(command.productId()))
            .orElseThrow(ProductNotFoundError::new);
        product.updatePrice(new Money(command.price().amount(), command.price().currency()));
        productRepository.save(product);
    }
}
